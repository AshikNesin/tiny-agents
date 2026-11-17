package groot.mobile.push

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import groot.kit.log.Log
import groot.mobile.BuildConfig
import groot.mobile.data.SessionStore
import groot.mobile.data.api.ApiException
import groot.mobile.data.api.PushDeviceBody
import groot.mobile.data.api.TinyAgentsApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.UnifiedPush
import org.unifiedpush.android.connector.data.PushEndpoint

private val Context.pushDataStore: DataStore<Preferences> by preferencesDataStore(name = "push")

/** Where this phone stands with the server's notifications, for Settings. */
data class PushStatus(
    val state: State = State.Unknown,
    /** "Google" for the embedded FCM distributor, else the distributor app's name (ntfy, say). */
    val via: String? = null,
    val detail: String? = null,
) {
    enum class State { Unknown, Registering, On, PermissionOff, NoDistributor, ServerTooOld, Failed, Unsupported }

    companion object {
        /**
         * Where the server's answer to `GET /notifications/vapid-key` leaves this phone. A guest
         * gets 403 and no notifications; a server from before issue #306 has no such route (404,
         * or a page that isn't JSON), which the owner fixes by updating the server.
         */
        fun ofKeyError(error: ApiException): PushStatus = when {
            error.status == 403 -> PushStatus(State.Unsupported)
            error.status == 404 || error.code == "BAD_RESPONSE" -> PushStatus(State.ServerTooOld)
            else -> PushStatus(State.Failed, detail = error.message)
        }
    }
}

/** A push service this phone can deliver through: Google (the embedded distributor) or a UnifiedPush app. */
data class PushService(val id: String, val label: String)

/**
 * Which distributor to register with: the owner's choice while it is installed, else Google
 * when the phone has Play services (no setup), else the first UnifiedPush app (ntfy, say).
 * [own] is this app's package, which is the embedded Google distributor.
 */
fun pickDistributor(own: String, installed: List<String>, chosen: String?, hasPlayServices: Boolean): String? =
    chosen?.takeIf { it in installed }
        ?: own.takeIf { hasPlayServices && it in installed }
        ?: installed.firstOrNull { it != own }
        ?: own.takeIf { it in installed }

/**
 * Registers this phone for the server's Web Push notifications (issue #306) through
 * UnifiedPush: Google's embedded FCM distributor by default (Play services, no Firebase
 * project), or a UnifiedPush app such as ntfy when the owner picks it in Settings. The server's VAPID key binds the
 * endpoint to that server; a different key (another server, a rotated key) registers again.
 */
class PushRegistrar(
    context: Context,
    private val api: TinyAgentsApi,
    private val session: SessionStore,
) {
    private val appContext = context.applicationContext
    private val store = appContext.pushDataStore
    private val _status = MutableStateFlow(PushStatus())
    val status: StateFlow<PushStatus> = _status.asStateFlow()
    private val _retries = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    /** Settings' "Try again": the open activity registers again (it can ask for the permission). */
    val retries: SharedFlow<Unit> = _retries.asSharedFlow()

    fun retry() {
        _retries.tryEmit(Unit)
    }

    /** The push services installed on this phone, Google first. */
    fun services(): List<PushService> =
        UnifiedPush.getDistributors(appContext)
            .sortedBy { it != appContext.packageName }
            .map { PushService(it, labelOf(it)) }

    /** Register through [id] from now on (Settings' Push service). */
    suspend fun choose(id: String) {
        store.edit { it[CHOICE] = id }
        retry()
    }

    private fun labelOf(distributor: String): String {
        if (distributor == appContext.packageName) return "Google"
        val pm = appContext.packageManager
        return runCatching { pm.getApplicationLabel(pm.getApplicationInfo(distributor, 0)).toString() }.getOrDefault(distributor)
    }

    private fun hasPlayServices(): Boolean =
        runCatching { appContext.packageManager.getPackageInfo(GOOGLE_PLAY_SERVICES, 0) }.isSuccess

    /**
     * After sign-in, on each launch: fetch the server's key, ask for the notification
     * permission ([askPermission], Android 13+), pick a distributor and register. Registering
     * again on every launch keeps the server's copy fresh and brings back a device it revoked.
     */
    suspend fun ensure(askPermission: suspend () -> Boolean) {
        val server = session.serverUrl ?: return
        val key = try {
            api.vapidKey()
        } catch (error: ApiException) {
            _status.value = PushStatus.ofKeyError(error)
            return
        } catch (error: Exception) {
            _status.update { it.copy(state = PushStatus.State.Failed, detail = error.message) }
            return
        }
        if (!askPermission()) {
            _status.value = PushStatus(PushStatus.State.PermissionOff)
            return
        }
        val prefs = store.data.first()
        if (prefs[SERVER] != server || prefs[VAPID] != key) {
            // Another server or a new key: the old endpoint is bound to the old key.
            if (prefs[VAPID] != null) withContext(Dispatchers.Main) { UnifiedPush.unregister(appContext) }
            store.edit {
                it.remove(DEVICE_ID)
                it[SERVER] = server
                it[VAPID] = key
            }
        }
        _status.value = PushStatus(PushStatus.State.Registering)
        val installed = UnifiedPush.getDistributors(appContext)
        val target = pickDistributor(appContext.packageName, installed, prefs[CHOICE], hasPlayServices())
        if (target == null) {
            _status.value = PushStatus(PushStatus.State.NoDistributor)
            return
        }
        val current = UnifiedPush.getSavedDistributor(appContext)
        if (current != target) {
            // Moving to another push service: the server drops the old endpoint, the old service the app.
            if (current != null) {
                forgetDevice()
                withContext(Dispatchers.Main) { UnifiedPush.removeDistributor(appContext) }
            }
            UnifiedPush.saveDistributor(appContext, target)
        }
        withContext(Dispatchers.Main) { UnifiedPush.register(appContext, vapid = key) }
    }

    /** The distributor gave this phone an endpoint (first time, or it changed): tell the server. */
    suspend fun onNewEndpoint(endpoint: PushEndpoint) {
        val keys = endpoint.pubKeySet ?: run {
            _status.value = PushStatus(PushStatus.State.Failed, detail = "The push service gave no encryption keys")
            return
        }
        if (session.token == null) return
        val embedded = UnifiedPush.getAckDistributor(appContext) == appContext.packageName
        try {
            val id = api.registerPushDevice(
                PushDeviceBody(
                    endpoint = endpoint.url,
                    p256dh = keys.pubKey,
                    auth = keys.auth,
                    distributor = if (embedded) "fcm" else "unifiedpush",
                    label = "${Build.MANUFACTURER.replaceFirstChar(Char::titlecase)} ${Build.MODEL}".trim(),
                    appVersion = BuildConfig.VERSION_NAME,
                ),
            )
            store.edit { it[DEVICE_ID] = id }
            _status.value = PushStatus(PushStatus.State.On, via = UnifiedPush.getAckDistributor(appContext)?.let(::labelOf))
        } catch (error: Exception) {
            Log.w(TAG, error) { "Registering the push endpoint failed" }
            _status.value = PushStatus(PushStatus.State.Failed, detail = error.message)
        }
    }

    fun onRegistrationFailed(reason: FailedReason) {
        _status.value = PushStatus(
            PushStatus.State.Failed,
            detail = when (reason) {
                FailedReason.NETWORK -> "No network while registering"
                FailedReason.ACTION_REQUIRED -> "The push service needs you to open it first"
                FailedReason.VAPID_REQUIRED -> "The push service needs a newer server"
                FailedReason.INTERNAL_ERROR -> "The push service refused the registration"
            },
        )
    }

    /** The distributor dropped this app (uninstalled, or the owner removed it there). */
    suspend fun onUnregistered() {
        forgetDevice()
        _status.value = PushStatus(PushStatus.State.NoDistributor)
    }

    /** Before signing out: the server stops sending here, and the distributor forgets the app. */
    suspend fun signOut() {
        forgetDevice()
        withContext(Dispatchers.Main) { UnifiedPush.unregister(appContext) }
        store.edit {
            it.remove(SERVER)
            it.remove(VAPID)
            it.remove(DEVICE_ID)
        }
        _status.value = PushStatus()
    }

    /** Null when the test went out, else why not. */
    suspend fun sendTest(): String? {
        val id = store.data.first()[DEVICE_ID] ?: return "This phone isn't registered yet"
        return api.testPushDevice(id)
    }

    private suspend fun forgetDevice() {
        val id = store.data.first()[DEVICE_ID] ?: return
        if (session.token != null) runCatching { api.removePushDevice(id) }
        store.edit { it.remove(DEVICE_ID) }
    }

    private companion object {
        const val TAG = "Push"
        val SERVER = stringPreferencesKey("server")
        val VAPID = stringPreferencesKey("vapid")
        val DEVICE_ID = stringPreferencesKey("device_id")
        /** The push service the owner picked; none means Google when the phone has it. */
        val CHOICE = stringPreferencesKey("distributor")
        const val GOOGLE_PLAY_SERVICES = "com.google.android.gms"
    }
}

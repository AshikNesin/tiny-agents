package groot.mobile.push

import android.app.Activity
import android.content.Context
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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.UnifiedPush
import org.unifiedpush.android.connector.data.PushEndpoint
import kotlin.coroutines.resume

private val Context.pushDataStore: DataStore<Preferences> by preferencesDataStore(name = "push")

/** Where this phone stands with the server's notifications, for Settings. */
data class PushStatus(
    val state: State = State.Unknown,
    /** "Google" for the embedded FCM distributor, else the distributor app's package. */
    val via: String? = null,
    val detail: String? = null,
) {
    enum class State { Unknown, Registering, On, PermissionOff, NoDistributor, Failed, Unsupported }
}

/**
 * Registers this phone for the server's Web Push notifications (issue #306) through
 * UnifiedPush: the distributor the owner uses (ntfy, say), else the embedded FCM distributor,
 * which needs Google Play services and no Firebase project. The server's VAPID key binds the
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

    /**
     * After sign-in, on each launch: fetch the server's key, ask for the notification
     * permission ([askPermission], Android 13+), pick a distributor and register. Registering
     * again on every launch keeps the server's copy fresh and brings back a device it revoked.
     */
    suspend fun ensure(activity: Activity, askPermission: suspend () -> Boolean) {
        val server = session.serverUrl ?: return
        val key = try {
            api.vapidKey()
        } catch (error: ApiException) {
            // A guest (403) or an older server (404): no phone notifications here.
            _status.value = PushStatus(PushStatus.State.Unsupported)
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
        val distributor = withContext(Dispatchers.Main) {
            suspendCancellableCoroutine { done ->
                UnifiedPush.tryUseCurrentOrDefaultDistributor(activity) { ok -> if (done.isActive) done.resume(ok) }
            }
        }
        if (!distributor) {
            _status.value = PushStatus(PushStatus.State.NoDistributor)
            return
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
            _status.value = PushStatus(PushStatus.State.On, via = if (embedded) "Google" else UnifiedPush.getAckDistributor(appContext))
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
        store.edit { it.clear() }
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
    }
}

package groot.mobile.push

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

data class PushStatus(
    val state: State = State.Unknown,
    val detail: String? = null,
) {
    enum class State { Unknown, Registering, On, PermissionOff, NoGooglePlay, ServerTooOld, Failed, Unsupported }

    companion object {
        fun ofKeyError(error: ApiException): PushStatus = when {
            error.status == 403 -> PushStatus(State.Unsupported)
            error.status == 404 || error.code == "BAD_RESPONSE" -> PushStatus(State.ServerTooOld)
            else -> PushStatus(State.Failed, detail = error.message)
        }
    }
}

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

    val retries: SharedFlow<Unit> = _retries.asSharedFlow()

    fun retry() {
        _retries.tryEmit(Unit)
    }

    private fun hasPlayServices(): Boolean =
        runCatching { appContext.packageManager.getPackageInfo(GOOGLE_PLAY_SERVICES, 0) }.isSuccess

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
            if (prefs[VAPID] != null) withContext(Dispatchers.Main) { UnifiedPush.unregister(appContext) }
            store.edit {
                it.remove(DEVICE_ID)
                it[SERVER] = server
                it[VAPID] = key
            }
        }
        _status.value = PushStatus(PushStatus.State.Registering)
        if (!hasPlayServices()) {
            _status.value = PushStatus(PushStatus.State.NoGooglePlay)
            return
        }
        val target = appContext.packageName
        val current = UnifiedPush.getSavedDistributor(appContext)
        if (current != target) {
            if (current != null) {
                forgetDevice()
                withContext(Dispatchers.Main) { UnifiedPush.removeDistributor(appContext) }
            }
            UnifiedPush.saveDistributor(appContext, target)
        }
        withContext(Dispatchers.Main) { UnifiedPush.register(appContext, vapid = key) }
    }

    suspend fun onNewEndpoint(endpoint: PushEndpoint) {
        val keys = endpoint.pubKeySet ?: run {
            _status.value = PushStatus(PushStatus.State.Failed, detail = "The push service gave no encryption keys")
            return
        }
        if (session.token == null) return
        try {
            val id = api.registerPushDevice(
                PushDeviceBody(
                    endpoint = endpoint.url,
                    p256dh = keys.pubKey,
                    auth = keys.auth,
                    distributor = "fcm",
                    label = "${Build.MANUFACTURER.replaceFirstChar(Char::titlecase)} ${Build.MODEL}".trim(),
                    appVersion = BuildConfig.VERSION_NAME,
                ),
            )
            store.edit { it[DEVICE_ID] = id }
            _status.value = PushStatus(PushStatus.State.On)
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

    suspend fun onUnregistered() {
        forgetDevice()
        _status.value = PushStatus(PushStatus.State.Failed, detail = "Google stopped delivering to this phone")
    }

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
        const val GOOGLE_PLAY_SERVICES = "com.google.android.gms"
    }
}

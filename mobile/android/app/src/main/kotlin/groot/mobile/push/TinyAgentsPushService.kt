package groot.mobile.push

import groot.mobile.GrootMobileApp
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage

/** Where the UnifiedPush distributor delivers: new endpoints, pushes, and being dropped. */
class TinyAgentsPushService : PushService() {
    private val container get() = (application as GrootMobileApp).container

    override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) {
        container.scope.launch {
            container.ensureSessionLoaded()
            container.push.onNewEndpoint(endpoint)
        }
    }

    override fun onMessage(message: PushMessage, instance: String) {
        // The connector decrypts with this app's keys; anything else isn't from the server.
        if (!message.decrypted) return
        val payload = PushPayload.parse(message.content.toString(Charsets.UTF_8)) ?: return
        // A push can start the process: read the session first, for the server's address.
        runBlocking { container.ensureSessionLoaded() }
        when (payload) {
            is PushPayload.Show -> container.pushNotifier.show(payload.spec(), container.session.serverUrl)
            is PushPayload.Dismiss -> container.pushNotifier.dismiss(payload.tag)
        }
    }

    override fun onRegistrationFailed(reason: FailedReason, instance: String) {
        container.push.onRegistrationFailed(reason)
    }

    override fun onUnregistered(instance: String) {
        container.scope.launch {
            container.ensureSessionLoaded()
            container.push.onUnregistered()
        }
    }
}

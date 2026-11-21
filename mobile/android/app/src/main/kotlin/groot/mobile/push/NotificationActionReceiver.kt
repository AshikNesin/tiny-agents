package groot.mobile.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import groot.mobile.GrootMobileApp
import kotlinx.coroutines.launch

class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val request = AnswerRequest.from(intent) ?: return
        val container = (context.applicationContext as GrootMobileApp).container
        val pending = goAsync()
        container.scope.launch {
            try {
                container.approvalAnswerer.answer(request)
            } finally {
                pending.finish()
            }
        }
    }
}

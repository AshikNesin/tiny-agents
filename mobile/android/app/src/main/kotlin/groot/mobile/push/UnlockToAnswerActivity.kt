package groot.mobile.push

import android.app.Activity
import android.app.KeyguardManager
import android.os.Bundle
import groot.mobile.GrootMobileApp
import kotlinx.coroutines.launch

class UnlockToAnswerActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val request = AnswerRequest.from(intent) ?: return finish()
        val container = (application as GrootMobileApp).container
        val keyguard = getSystemService(KeyguardManager::class.java)
        val answer = {
            container.scope.launch { container.approvalAnswerer.answer(request) }
            finish()
        }
        if (keyguard == null || !keyguard.isKeyguardLocked) {
            answer()
            return
        }
        keyguard.requestDismissKeyguard(
            this,
            object : KeyguardManager.KeyguardDismissCallback() {
                override fun onDismissSucceeded() {
                    answer()
                }

                override fun onDismissCancelled() {
                    finish()
                }

                override fun onDismissError() {
                    finish()
                }
            },
        )
    }
}

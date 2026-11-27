package groot.mobile.data

import groot.mobile.data.api.StepUpToken
import groot.mobile.data.api.TinyAgentsApi

class StepUp(private val api: TinyAgentsApi, private val now: () -> Long = System::currentTimeMillis) {
    private var token: String? = null
    private var expiresAt: Long = 0L

    fun current(): String? = token?.takeIf { now() < expiresAt - EXPIRY_MARGIN_MS }

    suspend fun confirm(password: String): String = hold(api.stepUp(password))

    private fun hold(issued: StepUpToken): String {
        token = issued.token
        expiresAt = issued.expiresAt
        return issued.token
    }

    fun clear() {
        token = null
        expiresAt = 0L
    }

    private companion object {
        const val EXPIRY_MARGIN_MS = 10_000L
    }
}

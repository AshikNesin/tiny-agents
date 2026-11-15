package groot.mobile.data

import groot.mobile.data.api.TinyAgentsApi

/**
 * The owner's step-up token for vault and connection changes: asked for with their password,
 * kept in memory only, and good for five minutes.
 */
class StepUp(private val api: TinyAgentsApi, private val now: () -> Long = System::currentTimeMillis) {
    private var token: String? = null
    private var expiresAt: Long = 0L

    /** A token that is still good, or null: ask for the password. */
    fun current(): String? = token?.takeIf { now() < expiresAt - EXPIRY_MARGIN_MS }

    suspend fun confirm(password: String): String {
        val issued = api.stepUp(password)
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

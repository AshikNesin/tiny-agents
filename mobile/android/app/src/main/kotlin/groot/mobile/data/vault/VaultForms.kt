package groot.mobile.data.vault

import groot.mobile.data.api.VaultItem
import groot.mobile.data.api.jsonOf
import groot.mobile.data.api.jsonOfNotNull
import groot.mobile.data.api.wrap
import org.json.JSONObject

object VaultKinds {
    val ORDER: List<String> = listOf("login", "card", "identity", "api_key")

    fun label(kind: String): String = when (kind) {
        "login" -> "Login"
        "card" -> "Card"
        "identity" -> "Contact"
        "api_key" -> "API key"
        else -> kind.replace('_', ' ').replaceFirstChar { it.uppercase() }
    }

    fun section(kind: String): String = when (kind) {
        "login" -> "Logins"
        "card" -> "Cards"
        "identity" -> "Contacts"
        "api_key" -> "API keys"
        else -> label(kind)
    }

    fun fields(kind: String): List<String> = when (kind) {
        "login" -> listOf("username", "password", "totp", "notes")
        "card" -> listOf("card_number", "card_expiry", "card_cvc", "card_holder", "card_billing_address", "notes")
        "identity" -> listOf("identity_name", "identity_email", "identity_phone", "identity_address", "notes")
        "api_key" -> listOf("value", "username", "notes")
        else -> emptyList()
    }

    fun usesWebsite(kind: String): Boolean = kind == "login" || kind == "card"

    fun fieldLabel(field: String): String = when (field) {
        "username" -> "Username"
        "password" -> "Password"
        "totp" -> "One-time password"
        "notes" -> "Notes"
        "card_number" -> "Card number"
        "card_expiry" -> "Expiry"
        "card_cvc" -> "Security code"
        "card_holder" -> "Name on card"
        "card_billing_address" -> "Billing address"
        "identity_name" -> "Name"
        "identity_email" -> "Email"
        "identity_phone" -> "Phone"
        "identity_address" -> "Address"
        "value" -> "Key"
        else -> field.replace('_', ' ').replaceFirstChar { it.uppercase() }
    }

    fun isSecret(field: String): Boolean = field in SECRET_FIELDS

    fun isMultiline(field: String): Boolean = field == "notes" || field.endsWith("address")

    fun placeholder(field: String): String = when (field) {
        "totp" -> "otpauth://totp/… or the setup key"
        "card_expiry" -> "MM/YYYY"
        else -> ""
    }

    fun backendLabel(backend: String): String = when (backend) {
        "onepassword" -> "1Password"
        "local" -> "Local"
        else -> backend
    }

    private val SECRET_FIELDS = setOf("password", "totp", "card_number", "card_cvc", "value")
}

object VaultApprovals {
    val ORDER: List<String> = listOf("every_use", "per_conversation", "allowed")

    fun label(approval: String): String = when (approval) {
        "every_use" -> "Ask every time"
        "per_conversation" -> "Ask once per chat"
        "allowed" -> "Don't ask"
        else -> approval
    }
}

private val HANDLE = Regex("^[a-z0-9][a-z0-9-]{0,47}$")

fun suggestHandle(title: String): String =
    title.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').take(MAX_HANDLE).trimEnd('-')

fun isValidHandle(handle: String): Boolean = HANDLE.matches(handle)

fun splitLines(text: String): List<String> = text.split('\n', ',').map { it.trim() }.filter { it.isNotEmpty() }

fun websiteUrls(text: String): List<String> =
    text.split(Regex("\\s+")).map { it.trim() }.filter { it.isNotEmpty() }
        .map { if (Regex("^https?://").containsMatchIn(it)) it else "https://$it" }

data class VaultPolicyDraft(
    val handle: String,
    val label: String? = null,
    val origins: List<String> = emptyList(),
    val hosts: List<String> = emptyList(),
    val injectName: String? = null,
    val injectFormat: String? = null,
    val tools: List<String> = emptyList(),
    val bots: List<String>? = null,
    val approval: String = "per_conversation",
    val allowUnattended: Boolean = false,
    val whenToUse: String = "",
    val disabled: Boolean = false,
    val field: String? = null,
) {
    fun toJson(kind: String): JSONObject {
        val card = kind == "card"
        val inject = injectName?.trim()?.takeIf { it.isNotEmpty() }?.let {
            jsonOf("as" to "header", "name" to it, "format" to (injectFormat ?: "{value}"))
        }
        return jsonOfNotNull(
            "handle" to handle.trim().lowercase(),
            "label" to label,
            "origins" to origins,
            "hosts" to hosts,
            "tools" to tools,
            "approval" to if (card) "every_use" else approval,
            "allowUnattended" to (!card && allowUnattended),
            "whenToUse" to whenToUse.trim(),
            "disabled" to disabled,
            "field" to field,
        ).put("inject", wrap(inject)).put("bots", wrap(bots))
    }

    companion object {
        fun defaultFor(kind: String, handle: String = ""): VaultPolicyDraft = VaultPolicyDraft(
            handle = handle,
            injectName = if (kind == "api_key") "Authorization" else null,
            injectFormat = if (kind == "api_key") "Bearer {value}" else null,
            approval = if (kind == "card") "every_use" else "per_conversation",
        )

        fun of(item: VaultItem): VaultPolicyDraft = VaultPolicyDraft(
            handle = item.handle,
            label = item.label,
            origins = item.origins,
            hosts = item.hosts,
            injectName = item.injectName,
            injectFormat = item.injectFormat,
            tools = item.tools,
            bots = item.bots,
            approval = item.policyApproval,
            allowUnattended = item.allowUnattended,
            whenToUse = item.whenToUse.orEmpty(),
            disabled = item.disabled,
            field = item.field,
        )
    }
}

fun vaultCreateBody(kind: String, title: String, website: String, values: Map<String, String>, policy: VaultPolicyDraft): JSONObject = jsonOf(
    "kind" to kind,
    "title" to title.trim(),
    "urls" to if (VaultKinds.usesWebsite(kind)) websiteUrls(website) else emptyList(),
    "values" to values.filterValues { it.isNotEmpty() },
    "policy" to policy.toJson(kind),
)

fun vaultPolicyBody(kind: String, policy: VaultPolicyDraft): JSONObject = jsonOf("policy" to policy.toJson(kind))

fun vaultValueBody(field: String, value: String): JSONObject = jsonOf("values" to mapOf(field to value))

private const val MAX_HANDLE = 48

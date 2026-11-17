package groot.mobile.push

import groot.mobile.data.api.int
import groot.mobile.data.api.intOrNull
import groot.mobile.data.api.objOrNull
import groot.mobile.data.api.string
import groot.mobile.data.api.stringOrNull
import org.json.JSONObject

/**
 * What the server's Web Push channel sends (`packages/core/src/notification/webpush.ts`,
 * `PushPayload`), decrypted by the UnifiedPush connector. Field for field with the server.
 */
sealed interface PushPayload {
    /** Show (or replace, by [tag]) a notification. */
    data class Show(
        val tag: String,
        val event: String?,
        val category: String?,
        val title: String,
        val message: String,
        /** App path, e.g. `/chats/<bot>?focus=approval:12`; opened through the link router. */
        val path: String?,
        val priority: Int,
        val actions: ApprovalActions?,
    ) : PushPayload

    /** Take back the notification shown under [tag]: its request was answered. */
    data class Dismiss(val tag: String) : PushPayload

    companion object {
        /** Null for anything this app version doesn't understand. */
        fun parse(text: String): PushPayload? {
            val json = runCatching { JSONObject(text) }.getOrNull() ?: return null
            if (json.int("v") != 1) return null
            val tag = json.stringOrNull("tag") ?: return null
            return when (json.stringOrNull("kind")) {
                "show" -> Show(
                    tag = tag,
                    event = json.stringOrNull("event"),
                    category = json.stringOrNull("category"),
                    title = json.string("title"),
                    message = json.string("message"),
                    path = json.stringOrNull("path"),
                    priority = json.int("priority"),
                    actions = json.objOrNull("actions")?.let(ApprovalActions::from),
                )
                "dismiss" -> Dismiss(tag)
                else -> null
            }
        }
    }
}

/** An approval the notification can answer (the server's `NotificationActions`). */
data class ApprovalActions(
    val kind: Kind,
    val botId: String,
    val taskId: Int,
    val tool: String,
    val grantable: Boolean,
) {
    enum class Kind { Tool, Vault }

    companion object {
        fun from(json: JSONObject): ApprovalActions? {
            val kind = when (json.stringOrNull("kind")) {
                "tool" -> Kind.Tool
                "vault" -> Kind.Vault
                else -> return null
            }
            return ApprovalActions(
                kind = kind,
                botId = json.stringOrNull("botId") ?: return null,
                taskId = json.intOrNull("taskId") ?: return null,
                tool = json.string("tool"),
                grantable = json.optBoolean("grantable", false),
            )
        }
    }
}

/** One answer a notification button gives: the same body the chat card posts. */
enum class ApprovalAnswer(val label: String) {
    Deny("Deny"),
    Approve("Approve"),
    /** Tool cards: approve and stop asking for this tool on this bot. */
    AlwaysAllow("Always allow"),
    /** Vault cards: approve the use for the rest of the chat. */
    ForThisChat("For this chat"),
}

/** Android's notification channels, one per server category; the owner tunes each in Android settings. */
enum class PushChannel(val id: String, val title: String, val importanceHigh: Boolean) {
    NeedsYou("needs_you", "Needs you", true),
    Updates("updates", "Updates", false),
    Security("security", "Security", true),
    System("system", "System", false),
    ;

    companion object {
        fun of(category: String?): PushChannel = when (category) {
            "needs_input" -> NeedsYou
            "security" -> Security
            "system" -> System
            else -> Updates
        }
    }
}

/** How one notification looks, decided without Android: the channel, its key and its buttons. */
data class NotificationSpec(
    val channel: PushChannel,
    val tag: String,
    val title: String,
    val text: String,
    val path: String?,
    val actions: ApprovalActions?,
    val buttons: List<ApprovalAnswer>,
)

/** The buttons of a chat card, in its order: Deny, Approve, then the third answer when the card has it. */
fun buttonsFor(actions: ApprovalActions?): List<ApprovalAnswer> = when (actions?.kind) {
    null -> emptyList()
    ApprovalActions.Kind.Tool -> listOf(ApprovalAnswer.Deny, ApprovalAnswer.Approve, ApprovalAnswer.AlwaysAllow)
    ApprovalActions.Kind.Vault -> listOfNotNull(
        ApprovalAnswer.Deny,
        ApprovalAnswer.Approve,
        ApprovalAnswer.ForThisChat.takeIf { actions.grantable },
    )
}

fun PushPayload.Show.spec(): NotificationSpec = NotificationSpec(
    channel = PushChannel.of(category),
    tag = tag,
    title = title,
    text = message,
    path = path,
    actions = actions,
    buttons = buttonsFor(actions),
)

/** What the approval route gets for a button: the body the chat card would post. */
data class ApprovalDecision(val approved: Boolean, val alwaysAllow: String?, val grant: Boolean)

fun decisionOf(answer: ApprovalAnswer, tool: String): ApprovalDecision = when (answer) {
    ApprovalAnswer.Deny -> ApprovalDecision(approved = false, alwaysAllow = null, grant = false)
    ApprovalAnswer.Approve -> ApprovalDecision(approved = true, alwaysAllow = null, grant = false)
    ApprovalAnswer.AlwaysAllow -> ApprovalDecision(approved = true, alwaysAllow = tool, grant = false)
    ApprovalAnswer.ForThisChat -> ApprovalDecision(approved = true, alwaysAllow = null, grant = true)
}

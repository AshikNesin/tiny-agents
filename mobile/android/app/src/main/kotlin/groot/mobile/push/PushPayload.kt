package groot.mobile.push

import groot.mobile.data.api.int
import groot.mobile.data.api.intOrNull
import groot.mobile.data.api.objOrNull
import groot.mobile.data.api.string
import groot.mobile.data.api.stringOrNull
import org.json.JSONObject

sealed interface PushPayload {
    data class Show(
        val tag: String,
        val event: String?,
        val category: String?,
        val title: String,
        val message: String,
        val path: String?,
        val priority: Int,
        val actions: ApprovalActions?,
    ) : PushPayload

    data class Dismiss(val tag: String) : PushPayload

    companion object {
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

enum class ApprovalAnswer(val label: String) {
    Deny("Deny"),
    Approve("Approve"),
    AlwaysAllow("Always allow"),
    ForThisChat("For this chat"),
}

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

data class NotificationSpec(
    val channel: PushChannel,
    val tag: String,
    val title: String,
    val text: String,
    val path: String?,
    val actions: ApprovalActions?,
    val buttons: List<ApprovalAnswer>,
)

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

data class ApprovalDecision(val approved: Boolean, val alwaysAllow: String?, val grant: Boolean)

fun decisionOf(answer: ApprovalAnswer, tool: String): ApprovalDecision = when (answer) {
    ApprovalAnswer.Deny -> ApprovalDecision(approved = false, alwaysAllow = null, grant = false)
    ApprovalAnswer.Approve -> ApprovalDecision(approved = true, alwaysAllow = null, grant = false)
    ApprovalAnswer.AlwaysAllow -> ApprovalDecision(approved = true, alwaysAllow = tool, grant = false)
    ApprovalAnswer.ForThisChat -> ApprovalDecision(approved = true, alwaysAllow = null, grant = true)
}

package groot.mobile.data.chat

import groot.mobile.data.api.ToolCall
import groot.mobile.data.api.ToolStatus

enum class ToolPhase { Pending, Running, Waiting, Done, Failed }

enum class ToolCard { Approval, VaultApproval, Credentials, Takeover, Question, AskedQuestions, BotHandoff, CodeHandoff }

data class ToolCallView(
    val phase: ToolPhase,
    val card: ToolCard?,
    val note: String?,
    val foldable: Boolean,
)

private fun phaseOf(status: ToolStatus): ToolPhase = when (status) {
    ToolStatus.Pending -> ToolPhase.Pending
    ToolStatus.Running -> ToolPhase.Running
    ToolStatus.AwaitingApproval, ToolStatus.AwaitingAnswer, ToolStatus.AwaitingCredentials, ToolStatus.AwaitingTakeover -> ToolPhase.Waiting
    ToolStatus.Done -> ToolPhase.Done
    ToolStatus.Error, ToolStatus.Denied, ToolStatus.Expired, ToolStatus.Aborted, ToolStatus.Interrupted -> ToolPhase.Failed
}

private fun noteOf(status: ToolStatus): String? = when (status) {
    ToolStatus.AwaitingApproval -> "waiting for your approval"
    ToolStatus.AwaitingAnswer -> "waiting for your answers"
    ToolStatus.AwaitingCredentials -> "waiting for you to sign in"
    ToolStatus.AwaitingTakeover -> "waiting for you on the computer"
    ToolStatus.Expired -> "nobody answered in time"
    ToolStatus.Interrupted -> "interrupted by a restart"
    ToolStatus.Aborted -> "stopped"
    ToolStatus.Denied -> "denied by you"
    else -> null
}

private fun cardOf(call: ToolCall, readOnly: Boolean): ToolCard? {
    val askable = !readOnly && call.taskId != null
    if (askable && call.status == ToolStatus.AwaitingApproval) {
        return if (call.vault != null) ToolCard.VaultApproval else ToolCard.Approval
    }
    if (askable && call.status == ToolStatus.AwaitingCredentials && call.credentials != null) return ToolCard.Credentials
    if (!readOnly && call.status == ToolStatus.AwaitingTakeover && call.takeover != null) return ToolCard.Takeover
    if (call.questions != null) {
        return if (askable && call.status == ToolStatus.AwaitingAnswer) ToolCard.Question else ToolCard.AskedQuestions
    }
    if (call.name == "message_bot") return ToolCard.BotHandoff
    if (call.code != null) return ToolCard.CodeHandoff
    return null
}

fun viewOf(call: ToolCall, readOnly: Boolean = false): ToolCallView {
    val phase = phaseOf(call.status)
    val card = cardOf(call, readOnly)
    var note = if (readOnly && phase == ToolPhase.Waiting) "not answered" else noteOf(call.status)
    if (card == ToolCard.AskedQuestions && note == null && call.answers == null) note = "dismissed by you"
    return ToolCallView(
        phase = phase,
        card = card,
        note = note,
        foldable = (phase == ToolPhase.Done || phase == ToolPhase.Failed) && card == null,
    )
}

fun isActive(call: ToolCall): Boolean = when (phaseOf(call.status)) {
    ToolPhase.Pending, ToolPhase.Running, ToolPhase.Waiting -> true
    else -> false
}

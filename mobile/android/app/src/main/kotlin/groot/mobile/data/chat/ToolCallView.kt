package groot.mobile.data.chat

import groot.mobile.data.api.ToolCall
import groot.mobile.data.api.ToolStatus

/*
 * How a tool call is shown, in one pure table (the web client's lib/tool-call-view.ts).
 * The agent reports twelve statuses; the chat asks a few questions of them: is the bot
 * still at it, is it waiting on the owner and for what, did it fail, which card draws it.
 */

/** Where a call is in its life. */
enum class ToolPhase { Pending, Running, Waiting, Done, Failed }

/** What draws the call when it is not a plain trace line. */
enum class ToolCard { Approval, VaultApproval, Credentials, Takeover, Question, AskedQuestions, BotHandoff, CodeHandoff }

data class ToolCallView(
    val phase: ToolPhase,
    /** The card that draws the call; null: a trace line. */
    val card: ToolCard?,
    /** How the call ended or what it waits on ("denied by you"). */
    val note: String?,
    /** Finished and drawn as a plain trace line: runs of these fold into one step. */
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

/**
 * How [call] is shown. [readOnly]: in a transcript whose cards cannot act (a past chat),
 * what still waits is shown as not answered, without a card.
 */
fun viewOf(call: ToolCall, readOnly: Boolean = false): ToolCallView {
    val phase = phaseOf(call.status)
    val card = cardOf(call, readOnly)
    var note = if (readOnly && phase == ToolPhase.Waiting) "not answered" else noteOf(call.status)
    // Questions that ended without answers were dismissed (the owner wrote in the chat instead).
    if (card == ToolCard.AskedQuestions && note == null && call.answers == null) note = "dismissed by you"
    return ToolCallView(
        phase = phase,
        card = card,
        note = note,
        foldable = (phase == ToolPhase.Done || phase == ToolPhase.Failed) && card == null,
    )
}

/** The bot is visibly at it: the call is pending, running or waiting on the owner. */
fun isActive(call: ToolCall): Boolean = when (phaseOf(call.status)) {
    ToolPhase.Pending, ToolPhase.Running, ToolPhase.Waiting -> true
    else -> false
}

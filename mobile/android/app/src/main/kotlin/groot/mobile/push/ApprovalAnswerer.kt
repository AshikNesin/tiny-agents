package groot.mobile.push

import groot.mobile.data.SessionStore
import groot.mobile.data.api.ApiException
import groot.mobile.data.api.TinyAgentsApi

/**
 * Answers an approval from its notification, through the same route the chat card uses. The
 * notification goes away on success; one that was already answered elsewhere says so briefly.
 */
class ApprovalAnswerer(
    private val api: TinyAgentsApi,
    private val notifier: PushNotifier,
    private val session: SessionStore,
) {
    suspend fun answer(request: AnswerRequest) {
        if (session.token == null) session.load()
        val decision = decisionOf(request.answer, request.tool)
        val path = "/chats/${request.botId}?focus=approval:${request.taskId}"
        try {
            api.decideApproval(request.botId, request.taskId, decision.approved, decision.alwaysAllow, decision.grant)
            notifier.dismiss(request.tag)
        } catch (error: ApiException) {
            if (error.status == 409 || error.status == 404) {
                notifier.note(request.tag, "Already answered", null, session.serverUrl, path)
            } else {
                notifier.note(request.tag, "Couldn't answer", error.message, session.serverUrl, path)
            }
        } catch (error: Exception) {
            notifier.note(request.tag, "Couldn't answer", "Tap to open the chat.", session.serverUrl, path)
        }
    }
}

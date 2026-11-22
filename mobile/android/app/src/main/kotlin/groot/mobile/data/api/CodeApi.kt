package groot.mobile.data.api

import groot.mobile.data.code.RewindPoint
import kotlinx.coroutines.flow.Flow
import org.json.JSONArray
import java.net.URLEncoder

data class WorkflowStart(val started: Boolean, val reason: String?, val view: ThreadPulls?)

class CodeApi(private val client: ApiClient) {
    private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    private fun thread(id: String) = "/code/threads/${enc(id)}"

    private fun reviewPath(id: String) = "/code/reviews/${enc(id)}"

    private fun harness(instanceId: String) = "/code/harnesses/${enc(instanceId)}"

    private fun list(data: Any?): JSONArray = data as? JSONArray ?: JSONArray()

    suspend fun harnesses(): List<CodeHarness> =
        client.getObject("/code/status").arr("harnesses").mapObjects(CodeHarness::from)

    fun events(): Flow<SseSignal> = client.events("/code/events")

    suspend fun threads(): List<CodeThreadSummary> =
        list(client.get("/code/threads")).mapObjects(CodeThreadSummary::from)

    suspend fun archived(): List<CodeThreadSummary> =
        list(client.get("/code/threads", mapOf("view" to "archived"))).mapObjects(CodeThreadSummary::from)

    suspend fun models(instanceId: String): List<CodeModel> =
        list(client.get("${harness(instanceId)}/models")).mapObjects(CodeModel::from)

    suspend fun projects(): List<CodeProject> = list(client.get("/code/projects")).mapObjects(CodeProject::from)

    suspend fun create(
        projectId: String,
        instanceId: String?,
        message: String,
        model: String? = null,
        effort: String? = null,
        permissionMode: String? = null,
    ): String = client.postObject(
        "/code/threads",
        jsonOfNotNull(
            "instanceId" to instanceId,
            "projectId" to projectId,
            "message" to message,
            "model" to model,
            "effort" to effort,
            "permissionMode" to permissionMode,
        ),
    ).string("threadId")

    suspend fun snapshot(id: String): CodeThreadSnapshot = CodeThreadSnapshot.from(client.getObject(thread(id)))

    fun threadEvents(id: String): Flow<SseSignal> = client.events("${thread(id)}/events")

    suspend fun markSeen(id: String, cursor: Int) {
        client.post("${thread(id)}/seen", jsonOf("cursor" to cursor))
    }

    suspend fun send(id: String, message: String, queue: Boolean = false): String =
        client.postObject("${thread(id)}/messages", jsonOfNotNull("message" to message, "queue" to queue.takeIf { it }))
            .string("status", "accepted")

    suspend fun interrupt(id: String) {
        client.post("${thread(id)}/interrupt")
    }

    suspend fun allow(id: String, requestId: String, allow: Boolean) {
        client.post("${thread(id)}/requests/${enc(requestId)}", jsonOf("decision" to if (allow) "allow" else "deny"))
    }

    suspend fun answer(id: String, requestId: String, answers: Map<String, String>) {
        client.post("${thread(id)}/requests/${enc(requestId)}", jsonOf("answers" to answers))
    }

    suspend fun recover(id: String, action: String) {
        client.post("${thread(id)}/recover", jsonOf("action" to action))
    }

    suspend fun queued(id: String, queuedId: String, action: String) {
        client.post("${thread(id)}/queued/${enc(queuedId)}/$action")
    }

    suspend fun settings(id: String, model: String? = null, permissionMode: String? = null): ThreadSettings =
        ThreadSettings.from(
            client.postObject("${thread(id)}/settings", jsonOfNotNull("model" to model, "permissionMode" to permissionMode)),
        )

    suspend fun setEffort(id: String, effort: String?): ThreadSettings =
        ThreadSettings.from(client.postObject("${thread(id)}/settings", jsonOf("effort" to effort)))

    suspend fun archive(id: String, archived: Boolean) {
        client.post("${thread(id)}/archive", jsonOf("archived" to archived))
    }

    suspend fun rename(id: String, title: String) {
        client.post("${thread(id)}/rename", jsonOf("title" to title))
    }

    suspend fun delete(id: String) {
        client.delete(thread(id))
    }

    suspend fun reviewFiles(id: String, scope: String? = null): List<ChangedFile> =
        list(client.get("${thread(id)}/review/files", mapOf("scope" to scope))).mapObjects(ChangedFile::from)

    suspend fun reviewFile(id: String, path: String, scope: String? = null): FileContents =
        FileContents.from(client.getObject("${thread(id)}/review/file", mapOf("path" to path, "scope" to scope)))

    suspend fun markViewed(id: String, path: String, hash: String, viewed: Boolean) {
        client.post("${thread(id)}/review/viewed", jsonOf("path" to path, "hash" to hash, "viewed" to viewed))
    }

    suspend fun addReviewDraft(id: String, path: String, startLine: Int, endLine: Int, quote: String, body: String, side: String = "new") {
        client.post(
            "${thread(id)}/review/drafts",
            jsonOf("path" to path, "side" to side, "startLine" to startLine, "endLine" to endLine, "quote" to quote, "body" to body),
        )
    }

    suspend fun reviewDraftCount(id: String): Int = list(client.get("${thread(id)}/review/drafts")).length()

    suspend fun sendReview(id: String): Int = client.postObject("${thread(id)}/review/send").int("sent")

    suspend fun pulls(id: String, fresh: Boolean = true): ThreadPulls =
        ThreadPulls.from(client.getObject("${thread(id)}/pr", mapOf("fresh" to fresh.toString())))

    suspend fun publish(id: String): ThreadPulls = ThreadPulls.from(client.postObject("${thread(id)}/publish"))

    suspend fun linkPull(id: String, number: Int): ThreadPulls =
        ThreadPulls.from(client.postObject("${thread(id)}/pr/link", jsonOf("number" to number)))

    suspend fun unlinkPull(id: String): ThreadPulls = ThreadPulls.from(client.postObject("${thread(id)}/pr/unlink"))

    suspend fun setAutofix(id: String, enabled: Boolean): ThreadPulls =
        ThreadPulls.from(client.postObject("${thread(id)}/pr/autofix", jsonOf("enabled" to enabled)))

    suspend fun runWorkflow(id: String, workflow: String): WorkflowStart {
        val result = client.postObject("${thread(id)}/workflows/${enc(workflow)}")
        return WorkflowStart(result.bool("started"), result.stringOrNull("reason"), result.objOrNull("view")?.let(ThreadPulls::from))
    }

    suspend fun rewind(id: String, point: RewindPoint): Boolean =
        client.postObject(
            "${thread(id)}/rewind",
            jsonOf("at" to point.at, "turn" to point.turn, "turns" to point.turns, "text" to point.text),
        ).bool("filesRestored")

    suspend fun merge(id: String, method: String): ThreadPulls =
        ThreadPulls.from(client.postObject("${thread(id)}/pr/merge", jsonOf("method" to method)))

    suspend fun reviews(): List<CodeReview> = list(client.get("/code/reviews")).mapObjects(CodeReview::from)

    suspend fun reviewInbox(): List<InboxPull> = list(client.get("/code/reviews/inbox")).mapObjects(InboxPull::from)

    suspend fun openReview(pr: String): CodeReview = CodeReview.from(client.postObject("/code/reviews", jsonOf("pr" to pr)))

    suspend fun review(id: String): CodeReview = CodeReview.from(client.getObject(reviewPath(id)))

    suspend fun agentReview(id: String) {
        client.post("${reviewPath(id)}/agent-review")
    }

    suspend fun decideFinding(id: String, findingId: String, add: Boolean): List<ReviewFinding> =
        list(client.post("${reviewPath(id)}/findings/${enc(findingId)}", jsonOf("action" to if (add) "add" else "dismiss")))
            .mapObjects(ReviewFinding::from)

    suspend fun archiveReview(id: String) {
        client.post("${reviewPath(id)}/archive")
    }

    suspend fun submitReview(id: String, verdict: ReviewVerdict, body: String): String =
        client.postObject("${reviewPath(id)}/submit", jsonOfNotNull("event" to verdict.wire, "body" to body.ifBlank { null })).string("url")

    suspend fun reviewConversations(id: String): List<PullConversation> =
        client.getObject("${reviewPath(id)}/threads").arr("threads").mapObjects(PullConversation::from)

    suspend fun replyToConversation(id: String, conversationId: String, body: String) {
        client.post("${reviewPath(id)}/threads/${enc(conversationId)}/reply", jsonOf("body" to body))
    }

    suspend fun resolveConversation(id: String, conversationId: String) {
        client.post("${reviewPath(id)}/threads/${enc(conversationId)}/resolve")
    }

    suspend fun githubDrafts(key: String): List<ReviewDraft> =
        list(client.get("${thread(key)}/review/drafts", mapOf("target" to "github"))).mapObjects(ReviewDraft::from)

    suspend fun addGithubDraft(key: String, path: String, line: Int, quote: String, body: String, side: String) {
        client.post(
            "${thread(key)}/review/drafts$GITHUB_TARGET",
            jsonOf("path" to path, "side" to side, "startLine" to line, "endLine" to line, "quote" to quote, "body" to body),
        )
    }

    suspend fun removeGithubDraft(key: String, draftId: String) {
        client.delete("${thread(key)}/review/drafts/${enc(draftId)}", mapOf("target" to "github"))
    }
}

private const val GITHUB_TARGET = "?target=github"

package groot.mobile.data.api

import kotlinx.coroutines.flow.Flow
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

class CodeApi(private val client: ApiClient) {
    private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    private fun thread(id: String) = "/code/threads/${enc(id)}"

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

    suspend fun checkCwd(instanceId: String, path: String): String? {
        val result = client.getObject("${harness(instanceId)}/validate-cwd", mapOf("path" to path))
        return if (result.bool("valid")) null else result.string("error", "That directory cannot be used.")
    }

    suspend fun create(
        instanceId: String?,
        message: String,
        projectId: String? = null,
        cwd: String? = null,
        model: String? = null,
        effort: String? = null,
        permissionMode: String? = null,
    ): String = client.postObject(
        "/code/threads",
        jsonOfNotNull(
            "instanceId" to instanceId,
            "projectId" to projectId,
            "message" to message,
            "cwd" to cwd,
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

    suspend fun diffs(instanceId: String, cwd: String): List<GitDiff> =
        client.getObject("${harness(instanceId)}/diffs", mapOf("cwd" to cwd)).arr("diffs").mapObjects(GitDiff::from)

    suspend fun diffFiles(instanceId: String, diffId: String, cwd: String): List<ChangedFile> =
        list(client.get("${harness(instanceId)}/diffs/${enc(diffId)}/files", mapOf("cwd" to cwd))).mapObjects(ChangedFile::from)

    suspend fun diffFile(instanceId: String, diffId: String, cwd: String, path: String): FileContents =
        FileContents.from(client.getObject("${harness(instanceId)}/diffs/${enc(diffId)}/file", mapOf("cwd" to cwd, "path" to path)))

    suspend fun reviewFiles(id: String): List<ChangedFile> =
        list(client.get("${thread(id)}/review/files")).mapObjects(ChangedFile::from)

    suspend fun reviewFile(id: String, path: String): FileContents =
        FileContents.from(client.getObject("${thread(id)}/review/file", mapOf("path" to path)))

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

    suspend fun setAutoMerge(id: String, enabled: Boolean): ThreadPulls =
        ThreadPulls.from(client.postObject("${thread(id)}/pr/automerge", jsonOf("enabled" to enabled)))

    suspend fun fixNow(id: String): ThreadPulls =
        ThreadPulls.from(client.postObject("${thread(id)}/pr/fix").objOrNull("view") ?: JSONObject())

    suspend fun merge(id: String, method: String): ThreadPulls =
        ThreadPulls.from(client.postObject("${thread(id)}/pr/merge", jsonOf("method" to method)))
}

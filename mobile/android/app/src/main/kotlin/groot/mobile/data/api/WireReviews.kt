package groot.mobile.data.api

import org.json.JSONObject

data class CodeReview(
    val id: String,
    val key: String,
    val repo: String,
    val number: Int,
    val url: String,
    val title: String,
    val author: String,
    val headRef: String,
    val baseRef: String,
    val headSha: String,
    val mine: Boolean,
    val reviewedSha: String?,
    val updatedAt: Long,
) {
    val hasNewCommits: Boolean get() = reviewedSha != null && reviewedSha != headSha

    companion object {
        fun from(json: JSONObject) = CodeReview(
            id = json.string("id"),
            key = json.string("key"),
            repo = json.string("repo"),
            number = json.int("number"),
            url = json.string("url"),
            title = json.string("title"),
            author = json.string("author"),
            headRef = json.string("headRef"),
            baseRef = json.string("baseRef"),
            headSha = json.string("headSha"),
            mine = json.bool("mine"),
            reviewedSha = json.stringOrNull("reviewedSha"),
            updatedAt = json.instant("updatedAt"),
        )
    }
}

data class InboxPull(
    val section: String,
    val repo: String,
    val number: Int,
    val title: String,
    val url: String,
    val author: String,
    val draft: Boolean,
    val updatedAt: Long,
    val decision: String?,
    val projectId: String?,
    val reviewId: String?,
) {
    companion object {
        fun from(json: JSONObject) = InboxPull(
            section = json.string("section"),
            repo = json.string("repo"),
            number = json.int("number"),
            title = json.string("title"),
            url = json.string("url"),
            author = json.string("author"),
            draft = json.bool("draft"),
            updatedAt = json.instant("updatedAt"),
            decision = json.stringOrNull("decision"),
            projectId = json.stringOrNull("projectId"),
            reviewId = json.stringOrNull("reviewId"),
        )
    }
}

data class PullComment(val id: String, val author: String, val bot: Boolean, val body: String, val createdAt: Long) {
    companion object {
        fun from(json: JSONObject) = PullComment(
            json.string("id"),
            json.string("author"),
            json.bool("bot"),
            json.string("body"),
            json.instant("createdAt"),
        )
    }
}

data class PullConversation(
    val id: String,
    val path: String,
    val line: Int?,
    val startLine: Int?,
    val resolved: Boolean,
    val outdated: Boolean,
    val comments: List<PullComment>,
) {
    companion object {
        fun from(json: JSONObject) = PullConversation(
            id = json.string("id"),
            path = json.string("path"),
            line = json.intOrNull("line"),
            startLine = json.intOrNull("startLine"),
            resolved = json.bool("resolved"),
            outdated = json.bool("outdated"),
            comments = json.arr("comments").mapObjects(PullComment::from),
        )
    }
}

data class ReviewDraft(
    val id: String,
    val path: String,
    val startLine: Int,
    val endLine: Int,
    val body: String,
) {
    val lines: String get() = if (startLine == endLine) "$startLine" else "$startLine-$endLine"

    companion object {
        fun from(json: JSONObject) = ReviewDraft(
            json.string("id"),
            json.string("path"),
            json.int("startLine"),
            json.int("endLine"),
            json.string("body"),
        )
    }
}

val INBOX_SECTIONS: List<Pair<String, String>> = listOf(
    "needs" to "Needs your review",
    "updated" to "Updated since your review",
    "waiting" to "Waiting on author",
    "mine" to "Your pull requests",
)

fun inboxBadge(pull: InboxPull): String? = when {
    pull.draft -> "Draft"
    pull.decision == "approved" -> "Approved"
    pull.decision == "changes_requested" -> "Changes requested"
    else -> null
}

enum class ReviewVerdict(val wire: String, val label: String) {
    Comment("COMMENT", "Comment"),
    Approve("APPROVE", "Approve"),
    RequestChanges("REQUEST_CHANGES", "Request changes"),
}

fun canSubmitReview(verdict: ReviewVerdict, body: String, comments: Int, mine: Boolean): Boolean = when {
    mine && verdict != ReviewVerdict.Comment -> false
    verdict == ReviewVerdict.RequestChanges -> body.isNotBlank()
    verdict == ReviewVerdict.Comment -> body.isNotBlank() || comments > 0
    else -> true
}

package groot.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import groot.mobile.data.AppLink
import groot.mobile.data.api.InboxPull
import groot.mobile.data.api.PullConversation
import groot.mobile.data.api.CodeReview
import groot.mobile.data.api.ReviewVerdict
import groot.mobile.data.api.canSubmitReview
import groot.mobile.data.api.inboxBadge
import groot.mobile.data.parseAppLink
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReviewsTest {
    @Test
    fun `a request for changes needs a summary, and a plain comment needs something to say`() {
        assertFalse(canSubmitReview(ReviewVerdict.RequestChanges, " ", comments = 3, mine = false))
        assertTrue(canSubmitReview(ReviewVerdict.RequestChanges, "Rename it", comments = 0, mine = false))
        assertFalse(canSubmitReview(ReviewVerdict.Comment, "", comments = 0, mine = false))
        assertTrue(canSubmitReview(ReviewVerdict.Comment, "", comments = 1, mine = false))
        assertTrue(canSubmitReview(ReviewVerdict.Approve, "", comments = 0, mine = false))
    }

    @Test
    fun `GitHub lets you comment on your own pull request, not approve it`() {
        assertFalse(canSubmitReview(ReviewVerdict.Approve, "LGTM", comments = 0, mine = true))
        assertTrue(canSubmitReview(ReviewVerdict.Comment, "Note", comments = 0, mine = true))
    }

    @Test
    fun `the agent's review brings a brief and the findings still open`() {
        val review = CodeReview.from(
            JSONObject(
                """{"id":"r1","key":"review:r1","number":7,"headSha":"bbb","reviewedSha":null,"reviewing":false,
                "brief":"Adds NOTES.md. Read it first.",
                "findings":[
                  {"id":"f1","severity":"nit","title":"No date","body":"Say when.","path":"NOTES.md","line":1,"state":"open"},
                  {"id":"f2","severity":"bug","title":"Wrong file","body":"Use the changelog.","path":"NOTES.md","line":2,"state":"added"},
                  {"id":"f3","severity":"question","title":"Unclear","body":"","path":"a.ts","line":3,"state":"open"}]}""",
            ),
        )
        assertEquals("Adds NOTES.md. Read it first.", review.brief)
        assertFalse(review.reviewing)
        assertEquals(listOf("f1", "f3"), review.openFindings.map { it.id })
        assertEquals("a.ts:3", review.findings.last().let { "${it.path}:${it.line}" })

        val waiting = CodeReview.from(JSONObject("""{"id":"r2","key":"review:r2","number":8,"headSha":"b","reviewing":true}"""))
        assertTrue(waiting.reviewing)
        assertEquals(null, waiting.brief)
        assertTrue(waiting.findings.isEmpty())
    }

    @Test
    fun `a review with commits after the one you read has new commits`() {
        val read = CodeReview.from(JSONObject("""{"id":"r1","key":"review:r1","number":7,"headSha":"bbb","reviewedSha":"aaa","updatedAt":"2026-11-21T10:00:00Z"}"""))
        val fresh = CodeReview.from(JSONObject("""{"id":"r2","key":"review:r2","number":8,"headSha":"bbb","reviewedSha":null}"""))
        assertTrue(read.hasNewCommits)
        assertFalse(fresh.hasNewCommits)
        assertEquals("review:r1", read.key)
    }

    @Test
    fun `the inbox badge says draft before the review decision`() {
        fun pull(draft: Boolean, decision: String?) = InboxPull.from(JSONObject().put("draft", draft).put("decision", decision ?: JSONObject.NULL))
        assertEquals("Draft", inboxBadge(pull(true, "approved")))
        assertEquals("Changes requested", inboxBadge(pull(false, "changes_requested")))
        assertEquals(null, inboxBadge(pull(false, "review_required")))
    }

    @Test
    fun `a conversation reads its comments and where it is`() {
        val conversation = PullConversation.from(
            JSONObject(
                """{"id":"t1","path":"src/a.ts","side":"new","line":12,"startLine":null,"resolved":false,"outdated":true,
                  "comments":[{"id":"c1","author":"ana","bot":false,"body":"Why?","createdAt":"2026-11-21T10:00:00Z"}]}""",
            ),
        )
        assertEquals(12, conversation.line)
        assertTrue(conversation.outdated)
        assertEquals(listOf("ana"), conversation.comments.map { it.author })
    }

    @Test
    fun `review links open the reviews screen or one review`() {
        val server = "https://agents.example.com"
        assertEquals(AppLink.Screen("code/reviews"), parseAppLink("$server/code/reviews", server))
        assertEquals(AppLink.Screen("code/reviews/r%201"), parseAppLink("$server/code/reviews/r%201", server))
    }
}

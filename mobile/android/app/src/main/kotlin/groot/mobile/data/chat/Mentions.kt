package groot.mobile.data.chat

data class MentionToken(val start: Int, val query: String)

data class MentionCandidate(val id: String, val name: String)

data class PickedMention(val start: Int, val botId: String, val name: String)

data class MentionResolution(val ids: List<String>, val ambiguous: List<String>)

data class MentionInsert(val text: String, val caret: Int, val picked: List<PickedMention>)

fun activeMentionToken(text: String, caret: Int): MentionToken? {
    var i = minOf(caret, text.length) - 1
    while (i >= 0) {
        val ch = text[i]
        if (ch.isWhitespace()) return null
        if (ch == '@') {
            val atTokenStart = i == 0 || text[i - 1].isWhitespace()
            return if (atTokenStart) MentionToken(i, text.substring(i + 1, caret)) else null
        }
        i--
    }
    return null
}

fun mentionMatches(candidates: List<MentionCandidate>, query: String): List<MentionCandidate> =
    candidates.filter { it.name.lowercase().startsWith(query.lowercase()) }

fun insertMention(text: String, token: MentionToken, caret: Int, chosen: MentionCandidate, picked: List<PickedMention>): MentionInsert {
    val insertion = "@${chosen.name} "
    val next = text.substring(0, token.start) + insertion + text.substring(caret)
    val kept = trackPickedMentions(text, next, picked).filter { it.start != token.start }
    return MentionInsert(next, token.start + insertion.length, kept + PickedMention(token.start, chosen.id, chosen.name))
}

fun trackPickedMentions(prev: String, next: String, picked: List<PickedMention>): List<PickedMention> {
    if (picked.isEmpty() || prev == next) return picked
    var head = 0
    val shortest = minOf(prev.length, next.length)
    while (head < shortest && prev[head] == next[head]) head++
    var tail = 0
    while (tail < shortest - head && prev[prev.length - 1 - tail] == next[next.length - 1 - tail]) tail++
    val editEnd = prev.length - tail
    val delta = next.length - prev.length
    return picked.mapNotNull { pick ->
        val end = pick.start + 1 + pick.name.length
        when {
            end <= head -> pick
            pick.start >= editEnd -> pick.copy(start = pick.start + delta)
            else -> null
        }
    }
}

private fun Char.isWordChar(): Boolean = isLetterOrDigit() || this == '_'

private fun pickStillInText(text: String, pick: PickedMention): Boolean {
    val end = pick.start + 1 + pick.name.length
    if (end > text.length || text.substring(pick.start, end) != "@${pick.name}") return false
    if (pick.start > 0 && !text[pick.start - 1].isWhitespace()) return false
    return end == text.length || !text[end].isWordChar()
}

private data class Range(val start: Int, val length: Int, val bot: MentionCandidate)

private fun mentionRanges(text: String, bot: MentionCandidate): List<Range> {
    val starts = LinkedHashMap<Int, Int>()
    for (name in setOf(bot.name, bot.name.lowercase())) {
        val needle = "@$name"
        var from = 0
        while (true) {
            val at = text.indexOf(needle, from)
            if (at < 0) break
            val end = at + needle.length
            val startOk = at == 0 || text[at - 1].isWhitespace()
            val endOk = end == text.length || !text[end].isWordChar()
            if (startOk && endOk) starts[at] = needle.length
            from = at + 1
        }
    }
    return starts.map { (start, length) -> Range(start, length, bot) }
}

fun resolveMentions(text: String, bots: List<MentionCandidate>, hostId: String, picked: List<PickedMention> = emptyList()): MentionResolution {
    val roster = bots.filter { it.id != hostId && it.name.isNotEmpty() }
    val kept = mutableListOf<Pair<String, Int>>()
    fun keep(id: String, start: Int) {
        val seen = kept.indexOfFirst { it.first == id }
        if (seen < 0) kept.add(id to start) else kept[seen] = id to minOf(kept[seen].second, start)
    }
    val claimed = mutableSetOf<Int>()
    for (pick in picked) {
        if (pick.start in claimed || !pickStillInText(text, pick)) continue
        if (roster.none { it.id == pick.botId }) continue
        claimed.add(pick.start)
        keep(pick.botId, pick.start)
    }
    val found = roster.flatMap { mentionRanges(text, it) }.filter { it.start !in claimed }.sortedByDescending { it.length }
    val ambiguous = mutableListOf<String>()
    for (match in found) {
        if (match.start in claimed) continue
        claimed.add(match.start)
        val rivals = found.filter { it.start == match.start && it.length == match.length }
        if (rivals.map { it.bot.id }.toSet().size > 1) {
            if (match.bot.name !in ambiguous) ambiguous.add(match.bot.name)
            continue
        }
        keep(match.bot.id, match.start)
    }
    return MentionResolution(kept.sortedBy { it.second }.map { it.first }, ambiguous)
}

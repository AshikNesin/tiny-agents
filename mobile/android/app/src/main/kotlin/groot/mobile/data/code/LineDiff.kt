package groot.mobile.data.code

/** One line of a diff: unchanged, added or removed, with its line numbers on each side. */
data class DiffLine(val kind: Kind, val text: String, val oldLine: Int?, val newLine: Int?) {
    enum class Kind { Same, Added, Removed, Gap }
}

/**
 * A line diff of two file versions, as the Changes screen draws it: changed lines with
 * [context] unchanged lines around them, and a [DiffLine.Kind.Gap] row (its text says how many
 * lines) where unchanged lines are left out. The server sends both versions; the web client
 * diffs them the same way.
 *
 * Common lines at the start and end are matched first; the rest by longest common
 * subsequence, unless it is too large, when it reads as all removed then all added.
 */
fun lineDiff(old: String, new: String, context: Int = 3): List<DiffLine> {
    val a = splitLines(old)
    val b = splitLines(new)
    var start = 0
    while (start < a.size && start < b.size && a[start] == b[start]) start++
    var endA = a.size
    var endB = b.size
    while (endA > start && endB > start && a[endA - 1] == b[endB - 1]) {
        endA--
        endB--
    }
    val full = ArrayList<DiffLine>(a.size + b.size)
    for (i in 0 until start) full.add(DiffLine(DiffLine.Kind.Same, a[i], i + 1, i + 1))
    middle(a, b, start, endA, start, endB, full)
    for (k in 0 until a.size - endA) full.add(DiffLine(DiffLine.Kind.Same, a[endA + k], endA + k + 1, endB + k + 1))
    return withContext(full, context)
}

private fun splitLines(text: String): List<String> {
    if (text.isEmpty()) return emptyList()
    val lines = text.replace("\r\n", "\n").split('\n')
    return if (lines.last().isEmpty()) lines.dropLast(1) else lines
}

private fun middle(a: List<String>, b: List<String>, a0: Int, a1: Int, b0: Int, b1: Int, out: MutableList<DiffLine>) {
    val n = a1 - a0
    val m = b1 - b0
    if (n.toLong() * m > MAX_CELLS) {
        for (i in a0 until a1) out.add(DiffLine(DiffLine.Kind.Removed, a[i], i + 1, null))
        for (j in b0 until b1) out.add(DiffLine(DiffLine.Kind.Added, b[j], null, j + 1))
        return
    }
    // lcs[i][j]: the longest common subsequence of a[a0+i until a1] and b[b0+j until b1].
    val lcs = Array(n + 1) { IntArray(m + 1) }
    for (i in n - 1 downTo 0) {
        for (j in m - 1 downTo 0) {
            lcs[i][j] = if (a[a0 + i] == b[b0 + j]) lcs[i + 1][j + 1] + 1 else maxOf(lcs[i + 1][j], lcs[i][j + 1])
        }
    }
    var i = 0
    var j = 0
    while (i < n || j < m) {
        when {
            i < n && j < m && a[a0 + i] == b[b0 + j] -> {
                out.add(DiffLine(DiffLine.Kind.Same, a[a0 + i], a0 + i + 1, b0 + j + 1))
                i++
                j++
            }
            // Removed lines before added ones, as a unified diff reads.
            i < n && (j == m || lcs[i + 1][j] >= lcs[i][j + 1]) -> {
                out.add(DiffLine(DiffLine.Kind.Removed, a[a0 + i], a0 + i + 1, null))
                i++
            }
            else -> {
                out.add(DiffLine(DiffLine.Kind.Added, b[b0 + j], null, b0 + j + 1))
                j++
            }
        }
    }
}

private fun withContext(lines: List<DiffLine>, context: Int): List<DiffLine> {
    val keep = BooleanArray(lines.size)
    for ((index, line) in lines.withIndex()) {
        if (line.kind == DiffLine.Kind.Same) continue
        for (k in maxOf(0, index - context)..minOf(lines.size - 1, index + context)) keep[k] = true
    }
    val out = ArrayList<DiffLine>()
    var skipped = 0
    for ((index, line) in lines.withIndex()) {
        if (keep[index]) {
            if (skipped > 0) out.add(gap(skipped))
            skipped = 0
            out.add(line)
        } else {
            skipped++
        }
    }
    if (skipped > 0 && out.isNotEmpty()) out.add(gap(skipped))
    return out
}

private fun gap(lines: Int) = DiffLine(DiffLine.Kind.Gap, "$lines unchanged ${if (lines == 1) "line" else "lines"}", null, null)

/**
 * The lines of a unified diff (a tool call's `diff`), each with its kind, for drawing. Headers
 * (`---`, `+++`, `@@`) become gaps that show the hunk header.
 */
fun parseUnifiedDiff(diff: String): List<DiffLine> = splitLines(diff).mapNotNull { line ->
    when {
        line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ") -> null
        line.startsWith("@@") -> DiffLine(DiffLine.Kind.Gap, line, null, null)
        line.startsWith("+") -> DiffLine(DiffLine.Kind.Added, line.substring(1), null, null)
        line.startsWith("-") -> DiffLine(DiffLine.Kind.Removed, line.substring(1), null, null)
        line.startsWith("\\") -> null
        else -> DiffLine(DiffLine.Kind.Same, line.removePrefix(" "), null, null)
    }
}

private const val MAX_CELLS = 4_000_000L

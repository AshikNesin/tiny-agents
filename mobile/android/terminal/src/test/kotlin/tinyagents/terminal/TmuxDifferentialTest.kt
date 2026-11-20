package tinyagents.terminal

import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test

class TmuxDifferentialTest {
    private var harness: Harness? = null

    @Before
    fun onlyWhenAskedFor() {
        assumeTrue("set TERMINAL_TMUX_TEST=1 to run", System.getenv("TERMINAL_TMUX_TEST") == "1")
        assumeTrue("tmux is not installed", onPath("tmux"))
        assumeTrue("python3 is not installed", onPath("python3"))
    }

    @After
    fun tearDown() {
        harness?.close()
    }

    @Test
    fun `shell output with colours`() = scenario("shell-colours") {
        run("ls --color=always -la /etc | head -40")
        check("ls --color")
        run("ls --color=always /usr/bin | head -60")
        check("ls --color in columns")
        run("printf '\\033[1mbold\\033[0m \\033[2mdim\\033[0m \\033[3mitalic\\033[0m \\033[4munder\\033[0m \\033[7minverse\\033[0m \\033[9mstrike\\033[0m \\033[1;3;4;31;44mall\\033[0m\\n'")
        check("printf SGR attributes")
        run("for i in 0 1 2 3 4 5 6 7; do printf \"\\033[3\${i}m fg\$i \\033[4\${i}m bg\$i \\033[0m\\033[9\${i}m hi\$i \\033[10\${i}m hb\$i \\033[0m\"; done; echo")
        check("printf 16 colours")
        run("clear; for i in \$(seq 0 255); do printf \"\\033[48;5;\${i}m%4d\" \$i; done; printf '\\033[0m\\n'")
        check("printf 256 backgrounds")
        run("for i in \$(seq 0 255); do printf \"\\033[38;5;\${i}m%4d\" \$i; done; printf '\\033[0m\\n'")
        check("printf 256 foregrounds")
        run("clear; for i in \$(seq 0 8 255); do printf \"\\033[48;2;\$i;\$((255-i));128m \\033[38;2;\$((255-i));0;\${i}mX\"; done; printf '\\033[0m\\n'")
        check("printf 24-bit colours")
        run("printf '\\033[38:2::255:100:0mcolon rgb\\033[0m \\033[38:5:45mcolon 256\\033[0m \\033[4:3mcurly\\033[0m \\033[4:3;58:2::255:0:0mred curly\\033[0m\\n'")
        check("printf colon forms")
        saveRecording("recorded-tmux-shell.bin")
    }

    @Test
    fun `long scrolling output`() = scenario("scrolling") {
        run("seq 1 500")
        check("seq 1 500")
        run("clear")
        check("clear")
        run("yes 'the quick brown fox jumps over the lazy dog' | head -3000 | cat -n")
        check("3000 numbered lines")
        run("seq 1 200 | paste -sd ' '")
        check("one long wrapped line")
        run("printf '%0.sx' \$(seq 1 100); echo; printf '%0.sy' \$(seq 1 99); echo; printf '%0.sz' \$(seq 1 101); echo")
        check("lines of exactly, under and over the width")
        run("for i in \$(seq 1 40); do printf 'progress %3d%% [%-50s]\\r' \$((i*100/40)) \$(printf '%0.s#' \$(seq 1 \$((i*50/40)))); done; echo")
        check("carriage-return progress bar")
        run("printf 'tabs\\tevery\\teight\\tcolumns\\t|\\n\\tindented\\n'")
        check("tabs")
        file(
            "apt.sh",
            """
            rows=${'$'}(stty size | cut -d' ' -f1)
            printf '\n\0337\033[0;%dr\0338\033[1A' ${'$'}((rows-1))
            for i in ${'$'}(seq 1 45); do
              echo "Unpacking package-${'$'}i (1.0-${'$'}i) over (0.9) ..."
              printf '\0337\033[%d;0f\033[42m\033[30mProgress: [%3d%%]\033[49m\033[39m [%-40s] \0338' ${'$'}rows ${'$'}((i*100/45)) ${'$'}(printf '%0.s#' ${'$'}(seq 1 ${'$'}((i*40/45))))
            done
            sleep 0.5
            printf '\0337\033[0;%dr\0338\033[1A\033[J' ${'$'}rows
            echo done
            """.trimIndent() + "\n",
        )
        tmux("send-keys", "-t", SESSION, "-l", "--", "sh apt.sh")
        tmux("send-keys", "-t", SESSION, "Enter")
        Thread.sleep(250)
        check("apt progress bar, while pinned")
        settle()
        check("apt progress bar, finished")
        file(
            "ink.sh",
            """
            printf '\033[?25l'
            frame() {
              printf '\033[?2026h'
              [ "${'$'}1" -gt 1 ] && printf '\033[2K\033[1A\033[2K\033[1A\033[2K\033[1A\033[2K\033[1A\033[2K\033[G'
              printf '\033[38;2;215;119;87m╭──────────────────────────────────────╮\033[39m\n'
              printf '\033[38;2;215;119;87m│\033[39m \033[1m✻ Thinking\033[22m \033[2m(frame %3d)\033[22m               \033[38;2;215;119;87m│\033[39m\n' "${'$'}1"
              printf '\033[38;2;215;119;87m╰──────────────────────────────────────╯\033[39m\n'
              printf '\033[2m  ? for shortcuts\033[22m \033[7m \033[27m\n'
              printf '\033[?2026l'
            }
            for i in ${'$'}(seq 1 30); do frame ${'$'}i; done
            printf '\033[?25h'
            """.trimIndent() + "\n",
        )
        run("clear; sh ink.sh")
        check("Ink-style frame redraws")
    }

    @Test
    fun `unicode wide and combining characters`() = scenario("unicode") {
        show("CJK", "日本語のテキスト 中文字符 한국어 ＦＵＬＬ\n")
        show("emoji", "emoji: 😀 🚀 🎉 👍 done\n")
        show("combining marks", "cafe\u0301 na\u0308ive o\u0302\u0301 x\n")
        show("box drawing and symbols", "┌──────┬──────┐\n│ left │ right│\n├──────┼──────┤\n└──────┴──────┘\n ▁▂▃▄▅▆▇█ ░▒▓ ● ✓ ✗ → ←\n")
        show("wide characters wrapping at the margin", "漢".repeat(70) + "\n")
        show("wide characters wrapping at an odd offset", "a" + "字".repeat(70) + "\n")
        show("latin and symbols", "äöü ÄÖÜ ß € ñ ç ø å æ œ λ π Ω ∑ ∞ ≠ ≤ ≥\n")
        show("mixed widths with colours", "\u001b[31m赤\u001b[42m緑の背景\u001b[0m plain \u001b[1;38;5;208m橙😀\u001b[0m e\u0301\u001b[4m下線\u001b[0m\n")
        run("clear")
        run("printf '\\033(0lqqqqwqqqqk\\nx    x    x\\ntqqqqnqqqqu\\nmqqqqvqqqqj\\n`afgjklmnopqrstuvwxyz{|}~\\033(B\\n'")
        check("DEC line drawing from a program", lineDrawing = true)
        assertTrue(screenText().contains("┌────┬────┐"))
        assertTrue(screenText().contains("├────┼────┤"))
    }

    @Test
    fun `vim`() = scenario("vim") {
        assumeProgram("vim")
        file("poem.txt", (1..200).joinToString("\n") { "line $it: the quick brown fox jumps over the lazy dog" } + "\n")
        run("vim -u NONE -N poem.txt")
        check("vim opened")
        keys(":set number", "Enter")
        keys(":syntax on", "Enter")
        check("vim :set number")
        keys("C-f", "C-f", "C-f")
        check("vim page down x3")
        keys("G")
        check("vim G")
        keys("gg", "10j", "5l")
        check("vim gg 10j 5l")
        keys("ihello from the emulator test", "Escape")
        check("vim insert")
        type("otabs\tand\twide 日本語 chars 😀 e\u0301".toByteArray(Charsets.UTF_8) + TerminalInput.key(TerminalKey.ESCAPE))
        check("vim open line with unicode")
        assertTrue(screenText().contains("wide 日本語 chars 😀 e\u0301"))
        keys(":split", "Enter")
        check("vim :split")
        keys(":vsplit", "Enter")
        check("vim :vsplit")
        keys("C-w", "j", "C-d", "C-d")
        check("vim scroll in lower window")
        keys(":only", "Enter", "C-b", "dd", "dd", "u")
        check("vim :only dd dd u")
        keys("/line 150", "Enter")
        check("vim search")
        keys(":set list hlsearch cursorline", "Enter")
        check("vim list hlsearch cursorline")
        keys(":help", "Enter")
        check("vim :help")
        saveRecording("recorded-tmux-vim.bin")
        val late = attach()
        check("vim seen by a late-attaching client", late)
        late.close()
        keys(":qa!", "Enter")
        check("after quitting vim")
        run("echo back at the shell")
        check("shell after vim")
    }

    @Test
    fun `less`() = scenario("less") {
        assumeProgram("less")
        file("long.txt", (1..400).joinToString("\n") { "row $it ${"lorem ipsum dolor sit amet ".repeat(1 + it % 5)}" } + "\n")
        run("less long.txt")
        check("less opened")
        keys("Space", "Space")
        check("less two pages down")
        keys("b")
        check("less page up")
        keys("/row 123", "Enter")
        check("less search with highlight")
        keys("G")
        check("less end")
        keys("g", "j", "j", "j", "k")
        check("less line scrolling")
        keys("-N")
        check("less line numbers")
        keys("q")
        check("after quitting less")
        run("less -S long.txt")
        keys("Right", "Right")
        check("less -S scrolled right")
        keys("q")
        check("after quitting less -S")
    }

    @Test
    fun `top`() = scenario("top") {
        assumeProgram("top")
        run("top -d 60")
        check("top")
        keys("1")
        check("top per-cpu")
        keys("z", "x")
        check("top colours")
        keys("q")
        check("after quitting top")
    }

    @Test
    fun `htop`() = scenario("htop") {
        assumeProgram("htop")
        run("htop -d 600")
        check("htop")
        keys("F5")
        check("htop tree")
        keys("Down", "Down", "Down")
        check("htop selection")
        keys("F2")
        check("htop setup")
        keys("Escape", "q")
        check("after quitting htop")
    }

    @Test
    fun `nano`() = scenario("nano") {
        assumeProgram("nano")
        file("note.txt", (1..80).joinToString("\n") { "note $it" } + "\n")
        run("nano note.txt")
        check("nano opened")
        keys("typed into nano ", "NPage", "NPage")
        check("nano typed and paged")
        keys("C-w", "note 70", "Enter")
        check("nano search")
        keys("C-g")
        check("nano help")
        keys("C-x")
        check("nano back from help")
        keys("C-x", "n")
        check("after quitting nano")
    }

    @Test
    fun `split panes and DEC line drawing borders`() {
        for (utf8 in listOf(true, false)) {
            scenario(if (utf8) "panes-utf8" else "panes-acs", utf8 = utf8) {
                run("seq 1 40")
                tmux("split-window", "-v", "-t", SESSION)
                tmux("split-window", "-h", "-t", SESSION)
                settle()
                keys("echo right pane; seq 100 130", "Enter")
                tmux("select-pane", "-t", "$SESSION:0.0")
                keys("echo top pane; seq 1000 1040", "Enter")
                tmux("select-pane", "-t", "$SESSION:0.1")
                keys("echo left pane; ls --color=always /etc | head -30", "Enter")
                check("three panes")
                tmux("resize-pane", "-t", "$SESSION:0.0", "-y", "8")
                check("after resize-pane")
                tmux("select-layout", "-t", SESSION, "even-horizontal")
                check("even-horizontal")
                tmux("kill-pane", "-t", "$SESSION:0.2")
                tmux("kill-pane", "-t", "$SESSION:0.1")
                check("one pane again")
            }
            harness?.close()
            harness = null
        }
    }

    @Test
    fun `client resize`() = scenario("resize") {
        run("seq 1 100")
        check("before resize")
        resize(80, 24)
        check("shrunk to 80x24")
        run("ls --color=always /etc | head -30")
        check("output at 80x24")
        resize(120, 40)
        check("grown to 120x40")
        run("seq 1 60")
        check("output at 120x40")
        assumeProgram("vim")
        file("poem.txt", (1..200).joinToString("\n") { "line $it: the quick brown fox jumps over the lazy dog" } + "\n")
        run("vim -u NONE -N poem.txt")
        check("vim at 120x40")
        resize(60, 20)
        check("vim shrunk to 60x20")
        keys("C-f")
        resize(100, 30)
        check("vim back at 100x30")
        keys(":q!", "Enter")
        check("after quitting vim")
    }

    @Test
    fun `production settings mouse wheel keys and paste`() = scenario("production", production = true) {
        val emulator = client.emulator
        assertTrue("tmux puts its client on the alternate screen", emulator.alternateScreen)
        assertTrue("mouse on: tmux asks for mouse reports", emulator.mouseTracking != MouseTracking.NONE)
        assertTrue("in SGR encoding", emulator.mouseSgrEncoding)
        assertTrue("focus-events on", emulator.focusEvents)
        assertEquals("status off: the pane is the whole client", ROWS, paneHeight())

        run("clear; for i in \$(seq 0 8 255); do printf \"\\033[48;2;\$i;\$((255-i));128m \\033[38;2;\$((255-i));0;\${i}mX\"; done; printf '\\033[0m\\n'")
        check("24-bit colours pass through")
        run("printf '\\033[4:3mcurly\\033[0m \\033[4:3;58:2::255:0:0mred curly\\033[0m \\033[9mstrike\\033[0m \\033[53moverline\\033[0m\\n'")
        check("underline styles and colours")

        type(TerminalInput.text("echo typed by the emulator") + TerminalInput.key(TerminalKey.ENTER))
        check("typed text")
        type(TerminalInput.key(TerminalKey.UP, applicationCursor = emulator.applicationCursorKeys))
        type(TerminalInput.key(TerminalKey.HOME, applicationCursor = emulator.applicationCursorKeys))
        type(TerminalInput.text("printf ok-; "))
        type(TerminalInput.key(TerminalKey.END, applicationCursor = emulator.applicationCursorKeys))
        type(TerminalInput.text(" again") + TerminalInput.key(TerminalKey.BACKSPACE) + TerminalInput.key(TerminalKey.ENTER))
        check("history, home, end and backspace")
        assertTrue("the edited line ran", screenText().contains("ok-typed by the emulator agai"))
        type(TerminalInput.text("echo interrupted") + TerminalInput.text("c", ctrl = true))
        type(TerminalInput.text("echo after ctrl-c") + TerminalInput.key(TerminalKey.ENTER))
        check("ctrl-c")

        assertTrue("bash asked for bracketed paste and tmux passed it on", emulator.bracketedPaste)
        type(TerminalInput.paste("echo pasted one\necho pasted two", emulator.bracketedPaste))
        check("bracketed paste is not executed line by line")
        assertTrue(!screenText().lines().any { it == "pasted one" })
        type(TerminalInput.key(TerminalKey.ENTER))
        check("after running the paste")
        assertTrue(screenText().lines().any { it == "pasted two" })

        run("clear; seq 1 500")
        check("before wheel")
        repeat(3) { type(TerminalInput.mouseWheel(up = true, col = 10, row = 10, sgr = emulator.mouseSgrEncoding)) }
        settle()
        assertEquals("the wheel put tmux in copy mode", "1", format("#{pane_in_mode}"))
        val scrolled = format("#{scroll_position}").toInt()
        assertTrue("and scrolled back", scrolled > 0)
        assertEquals("the emulator shows the scrolled history", "${500 - scrolled}", emulator.line(ROWS - 2).text())
        assertTrue("with tmux's position marker", emulator.line(0).text().endsWith("[$scrolled/${format("#{history_size}")}]"))
        record("wheel up x3 (copy mode, checked against scroll_position)", 2, 2)
        repeat(3) { type(TerminalInput.mouseWheel(up = false, col = 10, row = 10, sgr = emulator.mouseSgrEncoding)) }
        settle()
        assertEquals("wheel down leaves copy mode at the bottom", "0", format("#{pane_in_mode}"))
        check("after wheel down")

        type(TerminalInput.mouseButton(0, pressed = true, col = 5, row = 5, sgr = true))
        type(TerminalInput.mouseButton(0, pressed = false, col = 5, row = 5, sgr = true))
        type(TerminalInput.focus(gained = false) + TerminalInput.focus(gained = true))
        check("click and focus reports")

        assumeProgram("vim")
        file("poem.txt", (1..200).joinToString("\n") { "line $it: the quick brown fox jumps over the lazy dog" } + "\n")
        run("vim -u NONE -N poem.txt")
        type(TerminalInput.key(TerminalKey.PAGE_DOWN) + TerminalInput.key(TerminalKey.DOWN, applicationCursor = emulator.applicationCursorKeys))
        type(TerminalInput.text("A") + TerminalInput.text(" appended") + TerminalInput.key(TerminalKey.ESCAPE))
        check("vim driven by encoded keys")
        assertTrue(screenText().contains("lazy dog appended"))
        type(TerminalInput.text(":q!") + TerminalInput.key(TerminalKey.ENTER))
        check("after quitting vim")
    }

    @Test
    fun `raw escape sequences read by tmux and by the emulator`() = scenario("raw-sequences") {
        val random = java.util.Random(20261115)
        for (round in 1..120) {
            val (stream, operations) = RawSequences.generate(random, 40 + random.nextInt(160))
            compareRaw("round $round", stream, operations)
        }
    }

    private fun scenario(
        name: String,
        production: Boolean = false,
        utf8: Boolean = true,
        body: Harness.() -> Unit,
    ) {
        val h = Harness(name, production, utf8)
        harness = h
        h.start()
        try {
            h.body()
        } finally {
            h.report()
        }
        h.assertNoMismatch()
    }

    private fun Harness.assumeProgram(name: String) {
        assumeTrue("$name is not installed", onPath(name))
    }

    private class Harness(val name: String, val production: Boolean, val utf8: Boolean) {
        private val socket = "emu-test-$name-${System.nanoTime().toString(36)}"
        private val home: File = Files.createTempDirectory("emu-tmux-$name").toFile()
        private val helper = File(home, "pty_client.py").apply { writeText(PTY_CLIENT) }
        private val results = mutableListOf<Result>()
        private val clients = mutableListOf<Client>()
        lateinit var client: Client

        fun start() {
            val shell = "exec env -i HOME=${home.path} PATH=${System.getenv("PATH")} LC_ALL=C.UTF-8 TERM=\$TERM " +
                "PS1='\$ ' HISTFILE=/dev/null bash --norc --noprofile"
            val create = mutableListOf("new-session", "-d", "-s", SESSION, "-x", "$COLS", "-y", "$ROWS", "-c", home.path, shell)
            for (setting in if (production) PRODUCTION_SETTINGS else TEST_SETTINGS) {
                create += ";"
                create += setting
            }
            tmux(*create.toTypedArray())
            client = attach()
            settle()
        }

        fun attach(): Client {
            val command = mutableListOf("python3", helper.path, "$ROWS", "$COLS", "tmux", "-L", socket, "-f", "/dev/null")
            if (production) {
                for (setting in PRODUCTION_SETTINGS) {
                    command += setting
                    command += ";"
                }
            }
            command += listOf("attach-session", "-t", SESSION)
            val builder = ProcessBuilder(command).redirectErrorStream(false)
            builder.environment().apply {
                put("TERM", "xterm-256color")
                put("HOME", home.path)
                if (utf8) put("LC_ALL", "C.UTF-8") else put("LC_ALL", "C")
                remove("LANG")
                remove("TMUX")
            }
            val attached = Client(builder.start(), COLS, ROWS)
            clients += attached
            attached.settle()
            return attached
        }

        fun tmux(vararg args: String): String {
            val command = listOf("tmux", "-u", "-L", socket, "-f", "/dev/null") + args
            val builder = ProcessBuilder(command).redirectErrorStream(true)
            builder.environment().apply {
                put("LC_ALL", "C.UTF-8")
                put("HOME", home.path)
                remove("TMUX")
            }
            val process = builder.start()
            val output = process.inputStream.readBytes().toString(Charsets.UTF_8)
            check(process.waitFor(20, TimeUnit.SECONDS)) { "tmux ${args.joinToString(" ")} timed out" }
            check(process.exitValue() == 0) { "tmux ${args.joinToString(" ")} failed: $output" }
            return output
        }

        fun format(format: String): String = tmux("display-message", "-p", "-t", SESSION, format).trim()

        fun paneHeight(): Int = format("#{pane_height}").toInt()

        fun file(name: String, content: String) {
            File(home, name).writeText(content)
        }

        fun show(label: String, content: String) {
            file("show.txt", content)
            run("cat show.txt")
            check(label)
        }

        fun run(command: String) {
            tmux("send-keys", "-t", SESSION, "-l", "--", command)
            tmux("send-keys", "-t", SESSION, "Enter")
            settle()
        }

        fun keys(vararg keys: String) {
            for (key in keys) {
                if (key in KEY_NAMES || KEY_PATTERN.matches(key)) {
                    tmux("send-keys", "-t", SESSION, key)
                } else {
                    tmux("send-keys", "-t", SESSION, "-l", "--", key)
                }
                Thread.sleep(40)
            }
            settle()
        }

        fun type(bytes: ByteArray) {
            client.write(bytes)
            settle()
        }

        fun settle() {
            for (c in clients) c.settle()
        }

        fun resize(cols: Int, rows: Int) {
            settle()
            client.resize(cols, rows)
            settle()
        }

        fun screenText(): String = (0 until client.emulator.rows).joinToString("\n") { client.emulator.line(it).text() }

        fun saveRecording(fileName: String) {
            OUTPUT.mkdirs()
            File(OUTPUT, fileName).writeBytes(client.recording.toByteArray())
        }

        fun record(label: String, matched: Int, total: Int) {
            results += Result(label, matched, total, 0, 0, true, emptyList())
        }

        fun check(label: String, target: Client = client, lineDrawing: Boolean = false) {
            var result = compare(label, target, lineDrawing)
            var attempts = 1
            while (result.mismatches.isNotEmpty() && attempts < 5) {
                Thread.sleep(300L * attempts)
                settle()
                result = compare(label, target, lineDrawing)
                attempts++
            }
            results += result
        }

        private fun compare(label: String, target: Client, lineDrawing: Boolean): Result {
            target.settle()
            val emulator = target.emulator
            val mismatches = mutableListOf<String>()
            var rowsMatched = 0
            var rowsTotal = 0
            var cellsMatched = 0
            var cellsTotal = 0
            var cursorOk = true
            val covered = Array(emulator.rows) { BooleanArray(emulator.cols) }

            val panes = tmux(
                "list-panes", "-t", SESSION, "-F",
                "#{pane_id} #{pane_left} #{pane_top} #{pane_width} #{pane_height} #{pane_active} #{cursor_x} #{cursor_y} #{cursor_flag}",
            ).trim().lines().map { it.split(' ') }
            for (pane in panes) {
                val id = pane[0]
                val left = pane[1].toInt()
                val top = pane[2].toInt()
                val width = pane[3].toInt()
                val height = pane[4].toInt()
                val styled = replayStyledCapture(tmux("capture-pane", "-p", "-e", "-t", id), width, height)
                val expected = if (lineDrawing) {
                    (0 until height).map { styled.line(it).text() }
                } else {
                    tmux("capture-pane", "-p", "-t", id).removeSuffix("\n").split('\n')
                }
                for (row in 0 until height) {
                    val screenRow = top + row
                    if (screenRow >= emulator.rows) {
                        mismatches += "pane $id row $row is below the emulator's ${emulator.rows} rows"
                        rowsTotal++
                        continue
                    }
                    for (col in left until minOf(left + width, emulator.cols)) covered[screenRow][col] = true
                    val want = expected.getOrElse(row) { "" }
                    val got = cellsText(emulator.line(screenRow), left, width)
                    rowsTotal++
                    if (want == got) {
                        rowsMatched++
                    } else {
                        mismatches += "pane $id row $row\n      tmux: ${visible(want)}\n  emulator: ${visible(got)}"
                    }
                    val reference = styled.line(row)
                    val line = emulator.line(screenRow)
                    var last = width
                    while (last > 0 && reference.codePoint(last - 1) == ' '.code && reference.combining(last - 1) == null) last--
                    for (col in 0 until last) {
                        cellsTotal++
                        val mine = styleOf(line, left + col)
                        val theirs = styleOf(reference, col)
                        if (mine == theirs) {
                            cellsMatched++
                        } else if (mismatches.size < 12) {
                            mismatches += "pane $id row $row col $col style: tmux $theirs emulator $mine (${visible(want)})"
                        }
                    }
                }
                if (pane[5] == "1" && pane[8] == "1") {
                    val wantRow = top + pane[7].toInt()
                    val wantCol = left + pane[6].toInt()
                    val colOk = emulator.cursorCol == wantCol || (wantCol == left + width && emulator.cursorCol == wantCol - 1)
                    if (emulator.cursorRow != wantRow || !colOk) {
                        cursorOk = false
                        mismatches += "cursor: tmux $wantRow,$wantCol emulator ${emulator.cursorRow},${emulator.cursorCol}"
                    }
                    if (!emulator.cursorVisible) {
                        cursorOk = false
                        mismatches += "cursor: tmux shows it, the emulator hides it"
                    }
                }
            }

            val statusRows = if (production) 0 else 1
            for (row in 0 until emulator.rows - statusRows) {
                for (col in 0 until emulator.cols) {
                    if (covered[row][col]) continue
                    rowsTotal++
                    val cp = emulator.line(row).codePoint(col)
                    if (cp in 0x2500..0x257F) rowsMatched++ else mismatches += "border cell $row,$col is U+${cp.toString(16)}"
                }
            }
            if (statusRows == 1) {
                rowsTotal++
                val status = emulator.line(emulator.rows - 1).text()
                if (status.startsWith("[$SESSION] 0:")) rowsMatched++ else mismatches += "status line: ${visible(status)}"
            }
            try {
                emulator.checkInvariants()
            } catch (e: IllegalStateException) {
                mismatches += "invariant: ${e.message}"
            }
            return Result(label, rowsMatched, rowsTotal, cellsMatched, cellsTotal, cursorOk, mismatches)
        }

        fun compareRaw(label: String, stream: ByteArray, operations: List<Int>) {
            val index = results.size
            File(home, "raw-$index.bin").writeBytes(stream)
            val done = File(home, "raw-$index.done")
            val id = tmux(
                "new-window", "-d", "-P", "-F", "#{pane_id}", "-t", "$SESSION:", "-c", home.path,
                "stty -opost; cat raw-$index.bin; touch raw-$index.done; exec sleep 9999",
            ).trim()
            val deadline = System.nanoTime() + 10_000_000_000
            while (!done.exists() && System.nanoTime() < deadline) Thread.sleep(10)
            check(done.exists()) { "$label: the pane never finished reading" }
            Thread.sleep(60)

            val size = tmux("display-message", "-p", "-t", id, "#{pane_width} #{pane_height} #{cursor_x} #{cursor_y}").trim().split(' ').map { it.toInt() }
            val (width, height) = size
            val emulator = TerminalEmulator(width, height) {}
            emulator.feed(stream)
            val styled = replayStyledCapture(tmux("capture-pane", "-p", "-e", "-t", id), width, height)
            val expected = tmux("capture-pane", "-p", "-t", id).removeSuffix("\n").split('\n')
            val mismatches = mutableListOf<String>()
            var rowsMatched = 0
            var cellsMatched = 0
            var cellsTotal = 0
            for (row in 0 until height) {
                val want = expected.getOrElse(row) { "" }
                val got = emulator.line(row).text()
                if (want == got) rowsMatched++ else mismatches += "row $row\n      tmux: ${visible(want)}\n  emulator: ${visible(got)}"
                val reference = styled.line(row)
                var last = width
                while (last > 0 && reference.codePoint(last - 1) == ' '.code && reference.combining(last - 1) == null) last--
                for (col in 0 until last) {
                    cellsTotal++
                    val mine = styleOf(emulator.line(row), col)
                    val theirs = styleOf(reference, col)
                    if (mine == theirs) cellsMatched++ else if (mismatches.size < 12) mismatches += "row $row col $col style: tmux $theirs emulator $mine"
                }
            }
            val cursorOk = emulator.cursorRow == size[3] &&
                (emulator.cursorCol == size[2] || (size[2] == width && emulator.cursorCol == width - 1))
            if (!cursorOk) mismatches += "cursor: tmux ${size[3]},${size[2]} emulator ${emulator.cursorRow},${emulator.cursorCol}"
            if (mismatches.isNotEmpty()) {
                OUTPUT.mkdirs()
                File(OUTPUT, "$name-$index.raw").writeBytes(stream)
                File(OUTPUT, "$name-$index.ops").writeText(operations.joinToString(","))
                mismatches += "stream saved as $name-$index.raw"
            }
            results += Result(label, rowsMatched, height, cellsMatched, cellsTotal, cursorOk, mismatches)
            tmux("kill-pane", "-t", id)
        }

        fun report() {
            val lines = mutableListOf<String>()
            val rows = results.sumOf { it.rowsMatched } to results.sumOf { it.rowsTotal }
            val cells = results.sumOf { it.cellsMatched } to results.sumOf { it.cellsTotal }
            lines += "== $name: ${results.size} checks, rows ${rows.first}/${rows.second}, styled cells ${cells.first}/${cells.second}, " +
                "cursor ${results.count { it.cursorOk }}/${results.size}"
            for (result in results) {
                lines += "  ${if (result.mismatches.isEmpty()) "ok  " else "FAIL"} ${result.label}: rows ${result.rowsMatched}/${result.rowsTotal}, " +
                    "cells ${result.cellsMatched}/${result.cellsTotal}${if (result.cursorOk) "" else ", cursor differs"}"
                for (mismatch in result.mismatches.take(12)) lines += "       $mismatch"
            }
            val text = lines.joinToString("\n")
            java.io.PrintStream(java.io.FileOutputStream(java.io.FileDescriptor.out), true, "UTF-8").println(text)
            OUTPUT.mkdirs()
            File(OUTPUT, "$name.txt").writeText(text + "\n")
            File(OUTPUT, "$name.bin").writeBytes(client.recording.toByteArray())
        }

        fun assertNoMismatch() {
            val failed = results.filter { it.mismatches.isNotEmpty() }
            if (failed.isNotEmpty()) {
                fail("$name: ${failed.size} of ${results.size} checks differ from tmux: " + failed.joinToString { it.label } +
                    "\n" + failed.first().mismatches.take(6).joinToString("\n"))
            }
        }

        fun close() {
            for (c in clients) c.close()
            try {
                tmux("kill-server")
            } catch (_: IllegalStateException) {
            }
            home.deleteRecursively()
        }
    }

    private object RawSequences {
        private val words = listOf(
            "the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog", "0123456789", "~/src", "$", "#", "--help",
            "lorem ipsum dolor sit amet", "x", "ab", "END", "漢字", "日本語", "😀", "e\u0301", "ñ", "─│┌┐", "★",
        )

        fun generate(random: java.util.Random, operations: Int): Pair<ByteArray, List<Int>> {
            top = 1
            bottom = 29
            val out = ByteArrayOutputStream()
            val starts = mutableListOf<Int>()
            repeat(operations) {
                starts += out.size()
                out.write(operation(random).toByteArray(Charsets.UTF_8))
            }
            return out.toByteArray() to starts
        }

        private fun ascii(random: java.util.Random, length: Int): String =
            (1..length).map { "abcdefghijklmnopqrstuvwxyz0123456789 ._-"[random.nextInt(40)] }.joinToString("")

        private fun java.util.Random.count(): String = when (nextInt(4)) {
            0 -> ""
            1 -> "${nextInt(4)}"
            2 -> "${1 + nextInt(12)}"
            else -> "${1 + nextInt(120)}"
        }

        private fun java.util.Random.row(): Int = when (nextInt(5)) {
            0 -> 1
            1 -> 29
            else -> 1 + nextInt(31)
        }

        private fun java.util.Random.col(): Int = when (nextInt(6)) {
            0 -> 1
            1 -> 100
            2 -> 99
            else -> 1 + nextInt(104)
        }

        private fun text(random: java.util.Random): String {
            val out = StringBuilder()
            repeat(1 + random.nextInt(if (random.nextInt(6) == 0) 60 else 6)) {
                out.append(words[random.nextInt(words.size)])
                if (random.nextInt(4) != 0) out.append(' ')
            }
            return out.toString()
        }

        private fun sgr(random: java.util.Random): String {
            val codes = mutableListOf<String>()
            repeat(1 + random.nextInt(3)) {
                codes += when (random.nextInt(16)) {
                    0 -> "0"
                    1 -> ""
                    2 -> "${1 + random.nextInt(9)}"
                    3 -> "${listOf(22, 23, 24, 25, 27, 28, 29)[random.nextInt(7)]}"
                    4 -> "${30 + random.nextInt(8)}"
                    5 -> "${40 + random.nextInt(8)}"
                    6 -> "${90 + random.nextInt(8)}"
                    7 -> "${100 + random.nextInt(8)}"
                    8 -> "38;5;${random.nextInt(256)}"
                    9 -> "48;5;${random.nextInt(256)}"
                    10 -> "38;2;${random.nextInt(256)};${random.nextInt(256)};${random.nextInt(256)}"
                    11 -> "48;2;${random.nextInt(256)};${random.nextInt(256)};${random.nextInt(256)}"
                    12 -> "38:2::${random.nextInt(256)}:${random.nextInt(256)}:${random.nextInt(256)}"
                    13 -> "48:5:${random.nextInt(256)}"
                    14 -> "39"
                    else -> "49"
                }
            }
            return "$CSI${codes.joinToString(";")}m"
        }

        private var top = 1
        private var bottom = 29

        private fun operation(random: java.util.Random): String = when (random.nextInt(64)) {
            in 0..15 -> text(random)
            in 16..19 -> sgr(random)
            20, 21 -> "\r\n"
            22 -> "\r"
            23 -> "\n"
            24 -> "${CSI}C\b"
            25 -> "\t"
            in 26..29 -> "$CSI${random.row()};${random.col()}H"
            30 -> "$CSI${random.count()}A"
            31 -> "$CSI${random.count()}B"
            32 -> "$CSI${random.count()}C"
            33 -> "$CSI${random.count()}D"
            34 -> "$CSI${random.col()}G"
            35 -> "$CSI${random.row()}d"
            36 -> "$CSI${random.count()}${"EF"[random.nextInt(2)]}"
            37 -> if (random.nextBoolean()) "\r${CSI}J" else "${CSI}2J"
            38 -> {
                val prefix = 1 + random.nextInt(12)
                val line = "\r${CSI}2K${ascii(random, prefix)}${text(random).take(24)}"
                when (random.nextInt(4)) {
                    0 -> "$line$CSI${prefix + 1}G${CSI}K"
                    1 -> "$line$CSI${prefix}G${CSI}1K"
                    2 -> "$line$CSI${prefix}G${CSI}1J"
                    else -> "$line$CSI${prefix + 1}G${CSI}0J"
                }
            }
            39 -> "${CSI}2K"
            40, 42 -> {
                val line = "\r${CSI}2K${ascii(random, 30)}${text(random).take(24)}"
                "$line$CSI${1 + random.nextInt(12)}G$CSI${listOf("", "0", "1", "5", "12")[random.nextInt(5)]}${"XP"[random.nextInt(2)]}"
            }
            41 -> {
                val prefix = random.nextInt(12)
                "\r${CSI}2K${ascii(random, prefix)}${text(random).take(24)}$CSI${prefix + 1}G$CSI${listOf("", "0", "1", "7", "40")[random.nextInt(5)]}@"
            }
            43, 44 -> {
                top = 1 + random.nextInt(20)
                bottom = top + 1 + random.nextInt(29 - top)
                val row = top + random.nextInt(bottom - top + 1)
                "$CSI?6l$CSI$top;${bottom}r$CSI$row;${random.col()}H$CSI${random.count()}${"LM"[random.nextInt(2)]}\r"
            }
            45 -> "$CSI${1 + random.nextInt(6)}S"
            46 -> "$CSI${1 + random.nextInt(6)}T"
            47 -> {
                top = 1 + random.nextInt(20)
                bottom = top + 1 + random.nextInt(29 - top)
                "$CSI?6l$CSI$top;${bottom}r"
            }
            48 -> {
                top = 1
                bottom = 29
                "${CSI}r"
            }
            49 -> "${ESC}M"
            50 -> "${ESC}D"
            51 -> "${ESC}E"
            52 -> "${CSI}C${ESC}7"
            53 -> "${ESC}8"
            54 -> "$CSI?6${"hl"[random.nextInt(2)]}"
            55 -> "$CSI?7${"hl"[random.nextInt(2)]}"
            56 -> {
                val prefix = random.nextInt(12)
                "\r${CSI}2K${ascii(random, prefix)}${text(random).take(24)}$CSI${prefix + 1}G${CSI}4h${ascii(random, 1 + random.nextInt(12))}${CSI}4l"
            }
            57 -> listOf("${ESC}H", "${CSI}g", "${CSI}3g", "$CSI${random.count()}Z", "\t\t")[random.nextInt(5)]
            58 -> "$CSI${random.row()};${1 + random.nextInt(30)}H${ascii(random, 1)}$CSI${listOf("", "1", "5", "20", "30")[random.nextInt(5)]}b"
            59 -> if (random.nextBoolean()) "${CSI}49m$CSI?1049h${CSI}C${ESC}7$CSI?6l" else "${CSI}49m$CSI?1049h$CSI?1049l${CSI}C${ESC}7$CSI?6l"
            60 -> "${CSI}C${CSI}s"
            61 -> "${CSI}u"
            62 -> if (random.nextInt(8) == 0) {
                top = 1
                bottom = 29
                "$ESC#8"
            } else {
                "${CSI}2J"
            }
            else -> if (random.nextInt(8) == 0) {
                top = 1
                bottom = 29
                "${CSI}49m$CSI?1049h$CSI?1049l${CSI}C${ESC}7${ESC}c"
            } else {
                "${CSI}H"
            }
        }
    }

    private data class Result(
        val label: String,
        val rowsMatched: Int,
        val rowsTotal: Int,
        val cellsMatched: Int,
        val cellsTotal: Int,
        val cursorOk: Boolean,
        val mismatches: List<String>,
    )

    private class Client(private val process: Process, cols: Int, rows: Int) {
        val recording = ByteArrayOutputStream()
        val emulator = TerminalEmulator(cols, rows) { write(it) }
        private val incoming = LinkedBlockingQueue<ByteArray>()
        private val reader = Thread {
            val buffer = ByteArray(65536)
            val stream = process.inputStream
            while (true) {
                val read = try {
                    stream.read(buffer)
                } catch (_: java.io.IOException) {
                    -1
                }
                if (read < 0) break
                incoming.put(buffer.copyOf(read))
            }
        }.apply {
            isDaemon = true
            start()
        }

        private fun pump(): Boolean {
            var any = false
            while (true) {
                val chunk = incoming.poll() ?: break
                recording.write(chunk)
                emulator.feed(chunk)
                any = true
            }
            return any
        }

        fun settle(quietMillis: Long = 350, timeoutMillis: Long = 30_000) {
            val start = System.nanoTime()
            var lastActivity = start
            while (true) {
                val now = System.nanoTime()
                if (pump()) lastActivity = now
                if (now - lastActivity > quietMillis * 1_000_000) return
                if (now - start > timeoutMillis * 1_000_000) return
                Thread.sleep(15)
            }
        }

        fun write(bytes: ByteArray) {
            command("W " + bytes.joinToString("") { "%02x".format(it.toInt() and 0xFF) })
        }

        fun resize(cols: Int, rows: Int) {
            command("R $rows $cols")
            emulator.resize(cols, rows)
        }

        private fun command(line: String) {
            try {
                process.outputStream.write((line + "\n").toByteArray())
                process.outputStream.flush()
            } catch (_: java.io.IOException) {
            }
        }

        fun close() {
            try {
                process.outputStream.close()
            } catch (_: java.io.IOException) {
            }
            if (!process.waitFor(3, TimeUnit.SECONDS)) process.destroyForcibly()
            reader.join(2000)
        }
    }

    private companion object {
        const val COLS = 100
        const val ROWS = 30
        const val SESSION = "emu"
        val OUTPUT = File("build/tmux-differential")

        val TEST_SETTINGS = listOf(
            listOf("set", "-g", "default-terminal", "tmux-256color"),
            listOf("set", "-s", "terminal-features[90]", "xterm*:RGB"),
            listOf("set", "-s", "escape-time", "10"),
            listOf("set", "-g", "status-interval", "0"),
            listOf("set", "-g", "status-right", ""),
            listOf("set", "-g", "window-size", "latest"),
            listOf("set", "-g", "automatic-rename", "off"),
        )

        val PRODUCTION_SETTINGS = listOf(
            listOf("set", "-g", "status", "off"),
            listOf("set", "-g", "mouse", "on"),
            listOf("set", "-g", "history-limit", "50000"),
            listOf("set", "-s", "escape-time", "10"),
            listOf("set", "-s", "set-clipboard", "on"),
            listOf("set", "-s", "focus-events", "on"),
            listOf("set", "-g", "window-size", "latest"),
            listOf("set", "-s", "terminal-features[90]", "xterm*:RGB:clipboard:hyperlinks:strikethrough:usstyle:overline"),
        )

        val KEY_NAMES = setOf(
            "Enter", "Escape", "Space", "Tab", "BSpace", "Up", "Down", "Left", "Right", "Home", "End",
            "NPage", "PPage", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10",
        )
        val KEY_PATTERN = Regex("[CM]-.")

        fun onPath(program: String): Boolean =
            (System.getenv("PATH") ?: "").split(File.pathSeparator).any { File(it, program).canExecute() }

        fun replayStyledCapture(capture: String, width: Int, height: Int): TerminalEmulator {
            val reference = TerminalEmulator(width, height) {}
            val text = capture.removeSuffix("\n").replace("\n", "\r\n").replace(Regex("(?<=[\\[;])5:3(?=[;m])"), "53")
            reference.feed(("\u001b)0$text").toByteArray(Charsets.UTF_8))
            return reference
        }

        fun cellsText(line: TerminalLine, left: Int, width: Int): String {
            val out = StringBuilder()
            for (col in left until left + width) {
                if (line.width(col) == 0) continue
                out.appendCodePoint(line.codePoint(col))
                line.combining(col)?.let(out::append)
            }
            return out.toString().trimEnd(' ')
        }

        fun styleOf(line: TerminalLine, col: Int): String {
            val attributes = line.attributes(col) and TerminalAttribute.STYLE_MASK
            val blank = line.codePoint(col) == ' '.code
            val foreground = if (blank && attributes and (TerminalAttribute.INVERSE or TerminalAttribute.UNDERLINE or TerminalAttribute.STRIKETHROUGH) == 0) {
                0
            } else {
                line.foreground(col)
            }
            val flags = if (blank) attributes and (TerminalAttribute.INVERSE or TerminalAttribute.UNDERLINE or TerminalAttribute.STRIKETHROUGH) else attributes
            return "fg=${foreground.toString(16)} bg=${line.background(col).toString(16)} attrs=${flags.toString(16)}"
        }

        fun visible(text: String): String = "\"" + text.replace("\u001b", "\\e") + "\""

        val PTY_CLIENT = """
            import fcntl, os, pty, select, signal, struct, sys, termios

            rows, cols = int(sys.argv[1]), int(sys.argv[2])
            master, slave = pty.openpty()
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
            pid = os.fork()
            if pid == 0:
                os.close(master)
                os.setsid()
                fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
                for fd in (0, 1, 2):
                    os.dup2(slave, fd)
                if slave > 2:
                    os.close(slave)
                os.execvp(sys.argv[3], sys.argv[3:])
            os.close(slave)
            pending = b''
            stdin_open = True
            while True:
                watch = [master] + ([0] if stdin_open else [])
                ready, _, _ = select.select(watch, [], [])
                if master in ready:
                    try:
                        data = os.read(master, 65536)
                    except OSError:
                        data = b''
                    if not data:
                        break
                    os.write(1, data)
                if 0 in ready:
                    data = os.read(0, 65536)
                    if not data:
                        stdin_open = False
                        os.kill(pid, signal.SIGHUP)
                        continue
                    pending += data
                    while b'\n' in pending:
                        line, pending = pending.split(b'\n', 1)
                        parts = line.decode().split()
                        if parts and parts[0] == 'W':
                            os.write(master, bytes.fromhex(parts[1]))
                        elif parts and parts[0] == 'R':
                            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', int(parts[1]), int(parts[2]), 0, 0))
            os.waitpid(pid, 0)
        """.trimIndent()
    }
}

package groot.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import groot.kit.theme.S
import groot.mobile.ui.brand.Dims

/** One key of a [KeyBar]: a label or an icon, and what it stands for. */
data class BarKey<T>(val id: T, val label: String? = null, val icon: ImageVector? = null, val description: String = label.orEmpty(), val sticky: Boolean = false)

/**
 * A row of extra keys above the soft keyboard: the keys a phone keyboard lacks (Esc, Tab,
 * arrows) and sticky modifiers (Ctrl, Alt) that apply to the next key typed.
 */
@Composable
fun <T> KeyBar(keys: List<BarKey<T>>, held: Set<T>, onKey: (T) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = S.sm, vertical = S.xs),
        horizontalArrangement = Arrangement.spacedBy(S.xs),
    ) {
        for (key in keys) {
            val on = key.id in held
            Box(
                Modifier
                    .height(Dims.keyHeight)
                    .defaultMinSize(minWidth = Dims.keyMinWidth)
                    .clip(RoundedCornerShape(Dims.fieldRadius))
                    .background(if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh)
                    .clickable(role = Role.Button, onClickLabel = key.description) { onKey(key.id) }
                    .padding(horizontal = S.md),
                contentAlignment = Alignment.Center,
            ) {
                val color = if (on) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
                if (key.icon != null) {
                    AppIcon(key.icon, key.description, tint = color, size = Dims.iconSmall)
                } else {
                    Text(key.label.orEmpty(), color = color, style = MaterialTheme.typography.labelMedium.copy(fontFamily = FontFamily.Monospace))
                }
            }
        }
    }
}

/**
 * An invisible text field that turns the soft keyboard into a stream of keystrokes for a
 * remote screen: each character typed is handed to [onText] at once, and deleting past the
 * start is [onBackspace]. It holds one sentinel character so a backspace is always visible to
 * it, and asks for a password-style keyboard so nothing is composed, suggested or corrected.
 */
@Composable
fun RemoteKeyboard(active: Boolean, onText: (String) -> Unit, onBackspace: () -> Unit, modifier: Modifier = Modifier) {
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    var value by remember { mutableStateOf(TextFieldValue(SENTINEL, TextRange(SENTINEL.length))) }
    LaunchedEffect(active) {
        if (active) {
            focus.requestFocus()
            keyboard?.show()
        } else {
            keyboard?.hide()
        }
    }
    BasicTextField(
        value = value,
        onValueChange = { next ->
            val text = next.text
            when {
                text.length < SENTINEL.length -> onBackspace()
                text.startsWith(SENTINEL) && text.length > SENTINEL.length -> onText(text.substring(SENTINEL.length))
                text != SENTINEL -> onText(text)
            }
            value = TextFieldValue(SENTINEL, TextRange(SENTINEL.length))
        },
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.None,
            autoCorrectEnabled = false,
            keyboardType = KeyboardType.Password,
            imeAction = ImeAction.None,
        ),
        modifier = modifier.size(Dims.hairline).alpha(0f).focusRequester(focus),
    )
}

private const val SENTINEL = " "

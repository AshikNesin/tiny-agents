package groot.mobile.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.produceState
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.AvatarStore
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims

/** The app's wiring, for the routes that build ViewModels. */
val LocalContainer = staticCompositionLocalOf<AppContainer> { error("No AppContainer provided") }

// ---- Icons and buttons ------------------------------------------------------------------

@Composable
fun AppIcon(
    icon: ImageVector,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current,
    size: Dp = Dims.icon,
) {
    Icon(imageVector = icon, contentDescription = contentDescription, tint = tint, modifier = modifier.size(size))
}

/** A round icon button with a full touch target. */
@Composable
fun IconBtn(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tint: Color = MaterialTheme.colorScheme.onSurface,
    background: Color = Color.Transparent,
    iconSize: Dp = Dims.icon,
) {
    Box(
        modifier = modifier
            .size(Dims.iconButton)
            .clip(CircleShape)
            .background(background)
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        AppIcon(icon, contentDescription = null, tint = if (enabled) tint else tint.copy(alpha = DISABLED_ALPHA), size = iconSize)
    }
}

/** The one filled action of a screen: white on black in dark mode, black on white in light. */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    icon: ImageVector? = null,
) {
    PillButton(
        text = text,
        onClick = onClick,
        modifier = modifier,
        enabled = enabled && !loading,
        loading = loading,
        icon = icon,
        container = MaterialTheme.colorScheme.primary,
        content = MaterialTheme.colorScheme.onPrimary,
    )
}

/** A quieter action beside the primary one. */
@Composable
fun SecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    icon: ImageVector? = null,
    destructive: Boolean = false,
) {
    PillButton(
        text = text,
        onClick = onClick,
        modifier = modifier,
        enabled = enabled && !loading,
        loading = loading,
        icon = icon,
        container = MaterialTheme.colorScheme.surfaceContainerHigh,
        content = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
    )
}

@Composable
private fun PillButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier,
    enabled: Boolean,
    loading: Boolean,
    icon: ImageVector?,
    container: Color,
    content: Color,
) {
    Row(
        modifier = modifier
            .defaultMinSize(minHeight = S.touchTarget)
            .clip(CircleShape)
            .background(container.copy(alpha = if (enabled || loading) 1f else DISABLED_ALPHA))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = S.xl, vertical = S.sm),
        horizontalArrangement = Arrangement.spacedBy(S.sm, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (loading) {
            CircularProgressIndicator(modifier = Modifier.size(Dims.iconSmall), color = content, strokeWidth = Dims.stroke)
        } else if (icon != null) {
            AppIcon(icon, contentDescription = null, tint = content, size = Dims.iconSmall)
        }
        Text(text, color = content, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

/** A small rounded choice: a filter, a suggestion, a toggle among a few. */
@Composable
fun Chip(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    icon: ImageVector? = null,
    enabled: Boolean = true,
) {
    val container = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainer
    val content = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
    Row(
        modifier = modifier
            .clip(CircleShape)
            .background(container)
            .border(Dims.hairline, if (selected) Color.Transparent else MaterialTheme.colorScheme.outlineVariant, CircleShape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = S.md, vertical = S.sm)
            .alpha(if (enabled) 1f else DISABLED_ALPHA),
        horizontalArrangement = Arrangement.spacedBy(S.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) AppIcon(icon, contentDescription = null, tint = content, size = Dims.iconSmall)
        Text(text, color = content, style = MaterialTheme.typography.labelLarge, maxLines = 1)
    }
}

// ---- Surfaces ---------------------------------------------------------------------------

/** A card a step off the page: settings groups, approval cards, list items. */
@Composable
fun AppCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    padding: PaddingValues = PaddingValues(S.lg),
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Dims.cardRadius))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(padding),
        content = content,
    )
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(vertical = S.sm),
    )
}

@Composable
fun StatusDot(color: Color, modifier: Modifier = Modifier) {
    Box(modifier.size(Dims.dot).clip(CircleShape).background(color))
}

/**
 * Where bot faces come from. Null (screenshots, previews) draws the initial only; the
 * activity provides the app's [AvatarStore].
 */
val LocalAvatars = staticCompositionLocalOf<AvatarStore?> { null }

/** A bot's avatar: its face from the web app's avatar service, over its initial until (or unless) the face arrives. */
@Composable
fun BotAvatar(name: String, modifier: Modifier = Modifier, size: Dp = Dims.avatar) {
    val avatars = LocalAvatars.current
    // Keyed, not just restarted: the same slot showing another bot (the top bar after a switch)
    // must start from that bot's face, never keep the previous one.
    val face = key(avatars, name) {
        produceState(initialValue = avatars?.cached(name)) {
            if (value == null && avatars != null) value = avatars.load(name)
        }.value
    }
    Box(modifier.size(size).clip(CircleShape), contentAlignment = Alignment.Center) {
        val bitmap = face
        if (bitmap != null) {
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.matchParentSize().background(MaterialTheme.colorScheme.surfaceContainerHigh),
            )
        } else {
            Avatar(name, size = size)
        }
    }
}

/** A person's avatar (and a bot's until its face loads): the initial on a quiet disc. */
@Composable
fun Avatar(name: String, modifier: Modifier = Modifier, size: Dp = Dims.avatar) {
    val initial = name.trim().firstOrNull()?.uppercase() ?: "?"
    Box(
        modifier = modifier.size(size).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHigh),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = initial,
            color = MaterialTheme.colorScheme.onSurface,
            style = if (size >= Dims.avatarLarge) MaterialTheme.typography.headlineMedium else MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

// ---- Screen frame -----------------------------------------------------------------------

/** A screen under a plain top bar: back, a title, a few actions. The content pads itself. */
@Composable
fun ScreenScaffold(
    title: String,
    onBack: (() -> Unit)?,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable BoxScope.() -> Unit,
) {
    Column(modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).statusBarsPadding()) {
        Row(
            modifier = Modifier.fillMaxWidth().height(Dims.composerMinHeight).padding(horizontal = S.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                IconBtn(AppIcons.ArrowLeft, "Back", onBack)
            } else {
                Spacer(Modifier.width(S.md))
            }
            Column(Modifier.weight(1f).padding(horizontal = S.xs)) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (subtitle != null) {
                    Text(
                        subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            actions()
        }
        Box(Modifier.fillMaxSize(), content = content)
    }
}

/** A scrolling column for forms and detail pages, padded for the gesture bar. */
@Composable
fun ScreenColumn(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = S.lg)
            .padding(bottom = S.xl)
            .navigationBarsPadding(),
        verticalArrangement = Arrangement.spacedBy(S.md),
        content = content,
    )
}

@Composable
fun LoadingBox(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(modifier = Modifier.size(Dims.iconLarge), color = MaterialTheme.colorScheme.onSurfaceVariant, strokeWidth = Dims.stroke)
    }
}

/** Nothing here yet, or something went wrong: an icon, a line or two, and a way forward. */
@Composable
fun EmptyState(
    title: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    body: String? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(S.xxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(S.md, Alignment.CenterVertically),
    ) {
        if (icon != null) AppIcon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, size = Dims.logo)
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        if (body != null) {
            Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(S.xs))
            PrimaryButton(actionLabel, onAction)
        }
    }
}

// ---- Fields -----------------------------------------------------------------------------

/** A filled, rounded text field with its label above. */
@Composable
fun Field(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String = "",
    singleLine: Boolean = true,
    minLines: Int = 1,
    maxLines: Int = if (singleLine) 1 else 8,
    password: Boolean = false,
    enabled: Boolean = true,
    monospace: Boolean = false,
    supporting: String? = null,
    isError: Boolean = false,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(S.xs)) {
        if (label != null) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        val style = (if (monospace) MaterialTheme.typography.bodyMedium.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace) else MaterialTheme.typography.bodyLarge)
            .copy(color = MaterialTheme.colorScheme.onSurface)
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            enabled = enabled,
            singleLine = singleLine,
            minLines = minLines,
            maxLines = maxLines,
            textStyle = style,
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            modifier = Modifier.fillMaxWidth(),
            decorationBox = { inner ->
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = S.touchTarget)
                        .clip(RoundedCornerShape(Dims.fieldRadius))
                        .background(MaterialTheme.colorScheme.surfaceContainer)
                        .border(
                            Dims.hairline,
                            if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outlineVariant,
                            RoundedCornerShape(Dims.fieldRadius),
                        )
                        .padding(horizontal = S.lg, vertical = S.md),
                    contentAlignment = if (singleLine) Alignment.CenterStart else Alignment.TopStart,
                ) {
                    if (value.isEmpty() && placeholder.isNotEmpty()) {
                        Text(placeholder, style = style, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = maxLines)
                    }
                    inner()
                }
            },
        )
        if (supporting != null) {
            Text(
                supporting,
                style = MaterialTheme.typography.bodySmall,
                color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// ---- Sheets and dialogs -----------------------------------------------------------------

/** A bottom sheet with a title; the content scrolls and pads itself for the gesture bar. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Sheet(
    onDismiss: () -> Unit,
    title: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = state,
        shape = RoundedCornerShape(topStart = Dims.cardRadius, topEnd = Dims.cardRadius),
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = S.lg)
                .padding(bottom = S.xl),
            verticalArrangement = Arrangement.spacedBy(S.md),
        ) {
            if (title != null) {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            }
            content()
        }
    }
}

/** A launcher tile: an icon on a soft square over a short label. Grids of these replace long menus. */
@Composable
fun ActionTile(icon: ImageVector, label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(Dims.fieldRadius))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(vertical = S.sm, horizontal = S.xs),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(S.xs),
    ) {
        Box(
            Modifier.size(Dims.tile).clip(RoundedCornerShape(Dims.fieldRadius)).background(MaterialTheme.colorScheme.surfaceContainer),
            contentAlignment = Alignment.Center,
        ) {
            AppIcon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurface)
        }
        Text(label, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
    }
}

/** One tappable row of a sheet or menu. */
@Composable
fun MenuRow(
    icon: ImageVector,
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    summary: String? = null,
    destructive: Boolean = false,
    trailing: @Composable (() -> Unit)? = null,
) {
    val color = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Dims.fieldRadius))
            .clickable(role = Role.Button, onClick = onClick)
            .defaultMinSize(minHeight = S.touchTarget)
            .padding(horizontal = S.sm, vertical = S.sm),
        horizontalArrangement = Arrangement.spacedBy(S.lg),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AppIcon(icon, contentDescription = null, tint = color)
        Column(Modifier.weight(1f)) {
            Text(title, color = color, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (summary != null) {
                Text(summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
        trailing?.invoke()
    }
}

@Composable
fun ConfirmDialog(
    title: String,
    text: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    destructive: Boolean = false,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(confirmLabel, color = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", color = MaterialTheme.colorScheme.onSurfaceVariant) } },
        containerColor = MaterialTheme.colorScheme.surfaceContainer,
    )
}

const val DISABLED_ALPHA: Float = 0.38f

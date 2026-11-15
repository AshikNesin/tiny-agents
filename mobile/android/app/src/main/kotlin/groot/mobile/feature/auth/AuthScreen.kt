package groot.mobile.feature.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.Field
import groot.mobile.ui.components.PrimaryButton

@Composable
fun AuthRoute(container: AppContainer) {
    val viewModel: AuthViewModel = viewModel(factory = viewModelFactory { initializer { AuthViewModel(container.session, container.api) } })
    val state by viewModel.state.collectAsStateWithLifecycle()
    AuthScreen(state = state, onConnect = viewModel::connect, onSubmit = viewModel::submit, onChangeServer = viewModel::changeServer)
}

/** Which server, then who: the two steps before the first chat. */
@Composable
fun AuthScreen(
    state: AuthState,
    onConnect: (String) -> Unit,
    onSubmit: (email: String, password: String, name: String) -> Unit,
    onChangeServer: () -> Unit,
) {
    var server by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = S.xl, vertical = S.xxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(S.lg, Alignment.CenterVertically),
    ) {
        AppIcon(AppIcons.Brand, contentDescription = null, size = Dims.logo, tint = MaterialTheme.colorScheme.onBackground)
        Text("Tiny Agents", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(
            text = when {
                state.serverUrl == null -> "Connect to your tiny-agents server."
                state.needsSetup -> "This server is new. Create its first account."
                else -> "Sign in to ${state.serverUrl.substringAfter("://")}"
            },
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(S.sm))

        Column(Modifier.widthIn(max = Dims.contentMaxWidth / 2).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(S.md)) {
            if (state.serverUrl == null) {
                Field(
                    value = server,
                    onValueChange = { server = it },
                    label = "Server address",
                    placeholder = "agents.example.com",
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { onConnect(server) }),
                )
                PrimaryButton("Continue", onClick = { onConnect(server) }, loading = state.busy, modifier = Modifier.fillMaxWidth())
            } else {
                if (state.needsSetup) {
                    Field(value = name, onValueChange = { name = it }, label = "Name", placeholder = "Optional")
                }
                Field(
                    value = email,
                    onValueChange = { email = it },
                    label = "Email",
                    placeholder = "you@example.com",
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                )
                Field(
                    value = password,
                    onValueChange = { password = it },
                    label = "Password",
                    password = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { onSubmit(email, password, name) }),
                )
                PrimaryButton(
                    text = if (state.needsSetup) "Create account" else "Sign in",
                    onClick = { onSubmit(email, password, name) },
                    loading = state.busy,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (state.serverUrl.startsWith("http://")) {
                    Text(
                        "This server is not using HTTPS. Your password and chats travel unencrypted; use it only on a network you trust.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
                Text(
                    "Use a different server",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .align(Alignment.CenterHorizontally)
                        .clickable(role = Role.Button, onClick = onChangeServer)
                        .padding(S.sm),
                )
            }
            if (state.error != null) {
                Text(
                    state.error,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

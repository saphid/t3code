# Automatic thread titles

The native iOS app can configure automatic thread-title models separately for each environment.

Open **Settings > Environments**, choose an environment, then open **Automatic titles**. Select the primary model and, if needed, turn on **Use backup model**. The backup must belong to a different provider instance. Model-specific choices such as reasoning effort are saved with each selection.

T3 Code uses the primary model first. It makes one backup attempt only when the primary fails because of authentication, quota, rate limiting, availability, or another provider failure. Cancellation, an unsupported model, and invalid model output do not start the backup.

Turning the backup off returns to primary-only behavior. If a configured provider or model is removed or unavailable, the settings screen identifies the stale selection so you can reconnect it, choose another model, or disable the backup.

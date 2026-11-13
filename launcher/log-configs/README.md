# Minecraft logging configurations

Official Mojang client logging configurations, obtained from the version metadata for
1.7.10, 1.12.2, 1.20.1 and 1.21.8. Source URLs, SHA-1 and sizes are recorded in
manifest.json; logging.mjs pins and verifies the bundled bytes before use.

Some PCL installations omit assets/log_configs even though these files are listed
in the version JSON. A valid existing configuration is reused. For these known
standard IDs only, joincraft can use the bundled official configuration from its
own cache without modifying the installation. Unknown custom configurations are
never silently replaced. Checking files remains read-only.

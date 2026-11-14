# Joincraft managed host component

First adapter: Minecraft Java 1.20.1, Forge 47.x; compiled and discovery-tested against 47.3.33 and Java 17.

The client verifies the bundled JAR SHA-256, then installs it at:

```
<owned instance>/.minecraft/.joincraft/components/maven/com/joincraft/host-helper/1.0.0/host-helper-1.0.0.jar
```

Forge loads it with its built-in `--fml.mods com.joincraft:host-helper:1.0.0 --fml.mavenRoots .joincraft/components/maven` options. The Maven root is relative so commas in a Windows account path are not interpreted as separators. No copy or symlink is placed in `mods`; room pack contents and locks are unchanged. Only host launches receive these options. Guest launches use the built-in relay and Quick Play multiplayer; standalone launches remain unchanged.

The client selects an owned save by opaque folder ID and adds `--quickPlaySingleplayer <folder>`. A nonce-bound, short-lived local request instructs the client-only component to wait for that exact world's integrated server, preserve its game mode and command setting, and call `publishServer` with the selected port. It writes readiness atomically. The desktop then verifies a Java MC status response and rechecks room ownership and the exact pack before requesting a one-use relay ticket. No keyboard, mouse or game-screen automation is used.

Stopping cancels readiness, removes the private request/status files, closes the relay, and revokes the relay session. It leaves the game running. A LAN world already published inside Minecraft remains published locally until the world is exited; stopping the external relay prevents remote room members from connecting through Joincraft.

## Build and simulated checks

Install Java 17 and Gradle 8.8, then run `npm run build:helper`. `JAVA_HOME` selects the JDK and `JOINCRAFT_GRADLE` can select the Gradle executable. No Gradle game run tasks are configured or called. The build compiles and reobfuscates the JAR, runs seven game-free hosting state-machine scenarios, and uses Forge's actual MavenDirectoryLocator to discover and parse the real JAR from a Chinese/comma/space path while `mods` is empty. The standalone discovery harness supplies version metadata and module opens normally supplied by ModLauncher; it never starts Minecraft.

The generated manifest and JAR go to `build-resources/generated/host-helper`; electron-builder bundles them as `resources/host-helper`. Windows and Mac distribution scripts build this resource automatically. GitHub Actions provisions Java and Gradle.

Run `npm run test:game-play` after `npm run build` and `npm run build:helper`. Tests cover bounded Java NBT parsing, owned save traversal, component integrity, cancellation, delayed publication, role/pack checks, literal launch arguments and a real backend/TCP/WebSocket host-to-member flow with a simulated MC status server and fake Java spawn. They do not establish real-game compatibility.

## Windows acceptance still required

1. In a Joincraft-owned Forge 1.20.1 instance, create a test world, exit Minecraft, then refresh the save list.
2. As the room owner, select that pack, choose the test world and an available port, then start hosting. Confirm direct world entry and that Joincraft changes to hosting online without clicking Open to LAN.
3. With a matching owned instance and a different player identity, join on another PC. Confirm direct game entry and actual gameplay in the same world. First use may need launch-account settings; subsequent joins reuse saved settings.
4. Confirm the game mode/commands setting remains the same, the helper is not in `mods`, and stopping/closing the game disconnects the member.
5. Check slow world load, port occupied, loader failure, logout, room closure and cancellation during world loading. An occupied port must fail clearly, never mark the room online.

Real Forge/modpack/Windows gameplay has not been tested in this environment. Fabric, NeoForge, other Minecraft versions, arbitrary PCL folders and dedicated-server hosting are outside this first adapter.

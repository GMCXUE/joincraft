package com.joincraft.host;
import java.nio.file.*;
import java.util.*;
import net.minecraftforge.fml.loading.FMLPaths;
import net.minecraftforge.fml.loading.moddiscovery.MavenDirectoryLocator;
public final class LocatorTest {
    public static void main(String[] args) throws Exception {
        Path root=Path.of(args[0]).resolve("玩家, 测试"); Files.createDirectories(root);
        FMLPaths.loadAbsolutePaths(root);
        // Standalone discovery fixture supplies version metadata normally set by ModLauncher.
        var versions=net.minecraftforge.fml.loading.FMLLoader.class.getDeclaredField("versionInfo"); versions.setAccessible(true); versions.set(null,new net.minecraftforge.fml.loading.VersionInfo("47.3.33","1.20.1","20230612.114412","net.minecraftforge"));
        String relative=".joincraft/components/maven";
        Path helper=root.resolve(relative+"/com/joincraft/host-helper/1.0.0/host-helper-1.0.0.jar");
        Files.createDirectories(helper.getParent());Files.copy(Path.of(args[1]),helper,StandardCopyOption.REPLACE_EXISTING);
        var locator=new MavenDirectoryLocator();
        locator.initArguments(Map.of("mavenRoots",List.of(relative),"mods",List.of("com.joincraft:host-helper:1.0.0"),"modLists",List.of()));
        List<Path> found=locator.scanCandidates().toList();
        assert found.size()==1 && found.get(0).equals(helper);
        var modsFound=locator.scanMods(); assert modsFound.size()==1; assert modsFound.get(0).file()!=null; assert modsFound.get(0).file().getModInfos().get(0).getModId().equals("joincraft_host");
        try(var mods=Files.list(root.resolve("mods"))){assert mods.findAny().isEmpty();}
        System.out.println("Real Forge MavenDirectoryLocator discovered private helper; mods is empty; comma and Chinese path passed.");
    }
}

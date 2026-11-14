package com.joincraft.host;

import com.google.gson.Gson;
import net.minecraft.client.Minecraft;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import java.nio.file.*;
import java.io.IOException;
import java.util.Map;

@Mod("joincraft_host")
public final class JoincraftHost {
    // Client-only component: no packets, registries or server-side dependency.
    @Mod.EventBusSubscriber(modid="joincraft_host", value=Dist.CLIENT)
    public static final class Client {
        private static final Gson JSON = new Gson();
        private static HostSession session;
        private static Path request, status;
        private static String nonce;
        private static int port, ticks;
        private static boolean initialized, finished;
        private record Request(int schema, String nonce, String world, int port, long expiresAt) {}
        private static void initialize() {
            initialized = true;
            String property = System.getProperty("joincraft.host.request");
            if (property == null || property.isBlank()) { finished=true; return; }
            try {
                request=Path.of(property).toAbsolutePath().normalize();
                if (Files.isSymbolicLink(request) || !Files.isRegularFile(request) || Files.size(request)>4096) throw new IOException("Invalid request");
                Request data=JSON.fromJson(Files.readString(request), Request.class);
                if (data.schema()!=1 || data.nonce()==null || !data.nonce().matches("[a-f0-9]{64}") || data.expiresAt()<System.currentTimeMillis() || data.expiresAt()>System.currentTimeMillis()+21*60*1000) throw new IOException("Invalid request");
                nonce=data.nonce(); port=data.port(); status=request.resolveSibling(request.getFileName()+".status");
                session=new HostSession(data.world(),port,data.expiresAt());
                write(new HostSession.Result(HostSession.State.WAITING,"等待世界载入"));
            } catch (Exception error) { finished=true; }
        }
        private static void write(HostSession.Result result) throws IOException {
            Path temp=status.resolveSibling(status.getFileName()+".tmp");
            Files.writeString(temp,JSON.toJson(Map.of("schema",1,"nonce",nonce,"port",port,"state",result.state().name().toLowerCase(),"message",result.message())), StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING);
            try { Files.move(temp,status,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING); }
            catch (AtomicMoveNotSupportedException e) { Files.move(temp,status,StandardCopyOption.REPLACE_EXISTING); }
        }
        @SubscribeEvent
        public static void tick(TickEvent.ClientTickEvent event) {
            if(event.phase!=TickEvent.Phase.END || finished || ++ticks%20!=0) return;
            if(!initialized) initialize();
            if(finished || session==null) return;
            try {
                Minecraft mc=Minecraft.getInstance();
                var server=mc.getSingleplayerServer();
                HostSession.World world=server==null || mc.level==null || mc.player==null ? null : new HostSession.World() {
                    public String folder(){ return server.getWorldPath(LevelResource.ROOT).toAbsolutePath().normalize().getFileName().toString(); }
                    public boolean published(){ return server.isPublished(); }
                    public int port(){ return server.getPort(); }
                    public boolean publish(int requested){ return server.publishServer(server.getDefaultGameType(),server.getWorldData().getAllowCommands(),requested); }
                };
                HostSession.Result result=session.tick(System.currentTimeMillis(),Files.isRegularFile(request,LinkOption.NOFOLLOW_LINKS),world);
                if(result.state()!=HostSession.State.WAITING){ write(result); finished=true; }
            } catch(Exception error) {
                try { write(new HostSession.Result(HostSession.State.FAILED,"自动开放世界失败，请查看游戏日志")); } catch(IOException ignored) {}
                finished=true;
            }
        }
    }
}

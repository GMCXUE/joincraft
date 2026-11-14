package com.joincraft.host;

/** Game-free state machine: publishing is explicit, bounded and attempted once. */
public final class HostSession {
    public interface World {
        String folder(); boolean published(); int port(); boolean publish(int port);
    }
    public enum State { WAITING, READY, FAILED, CANCELLED }
    public record Result(State state, String message) {}
    private final String folder;
    private final int port;
    private final long deadline;
    private Result result = new Result(State.WAITING, "等待世界载入");
    public HostSession(String folder, int port, long deadline) {
        if (folder == null || folder.isBlank() || folder.equals(".") || folder.equals("..") || folder.contains("/") || folder.contains("\\") || port < 1024 || port > 65535) throw new IllegalArgumentException("Invalid host request");
        this.folder = folder; this.port = port; this.deadline = deadline;
    }
    public Result tick(long now, boolean active, World world) {
        if (result.state() != State.WAITING) return result;
        if (!active) return result = new Result(State.CANCELLED, "开房已取消");
        if (now > deadline) return result = new Result(State.FAILED, "世界载入超时");
        if (world == null) return result;
        if (!folder.equals(world.folder())) return result = new Result(State.FAILED, "载入的世界与所选存档不一致");
        if (world.published()) return result = world.port() == port ? new Result(State.READY, "世界已开放") : new Result(State.FAILED, "世界已使用其他局域网端口");
        return result = world.publish(port) ? new Result(State.READY, "世界已开放") : new Result(State.FAILED, "无法开放端口，请检查端口是否被占用");
    }
}

package com.joincraft.host;
public final class HostSessionTest {
    static class World implements HostSession.World {
        String folder="建筑世界"; boolean published=false, success=true; int calls=0, port=25565;
        public String folder(){return folder;} public boolean published(){return published;} public int port(){return port;} public boolean publish(int p){calls++;port=p;return success;}
    }
    public static void main(String[] args) {
        HostSession s=new HostSession("建筑世界",25565,100); World w=new World();
        assert s.tick(1,true,null).state()==HostSession.State.WAITING;
        assert s.tick(2,true,w).state()==HostSession.State.READY;
        s.tick(3,true,w); assert w.calls==1 && w.port==25565;
        assert new HostSession("建筑世界",25565,100).tick(1,false,w).state()==HostSession.State.CANCELLED;
        assert new HostSession("建筑世界",25565,100).tick(101,true,w).state()==HostSession.State.FAILED;
        w.folder="另一个存档"; assert new HostSession("建筑世界",25565,100).tick(1,true,w).state()==HostSession.State.FAILED; assert w.calls==1;
        w.folder="建筑世界"; w.success=false; assert new HostSession("建筑世界",25565,100).tick(1,true,w).state()==HostSession.State.FAILED;
        w.published=true;w.port=25566;assert new HostSession("建筑世界",25565,100).tick(1,true,w).state()==HostSession.State.FAILED;
        System.out.println("Host helper simulation: 7 scenarios passed; no Minecraft process launched.");
    }
}

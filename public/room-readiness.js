// Older servers omit explicit readiness; their online transport remains the fallback.
export function canJoinGame(room){const connection=room?.connection;return !!room&&!room.closed&&connection?.status==='online'&&connection.hostOnline!==false&&connection.joinable!==false;}
export function gameWaitingMessage(room){if(room?.closed)return '房间已关闭';if(room?.connection?.hostOnline===false||!room?.connection||room.connection.status==='offline')return '等待房主上线并开房';if(room.connection.status==='error')return '房主的游戏连接已断开，请等待重新开房';return '房主正在准备游戏，请稍候';}

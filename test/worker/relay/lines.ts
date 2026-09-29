/** Synthetic IRC lines in the form Twitch sends them. None of them is a captured one. */

export interface ChatLineOptions {
    id: string;
    userId?: string;
    command?: "PRIVMSG" | "USERNOTICE";
    text?: string;
}

export function chatLine(channel: string, options: ChatLineOptions): string {
    const { id, userId = "1001", command = "PRIVMSG", text = `synthetic line ${id}` } = options;
    return (
        `@badge-info=;badges=;color=#1E90FF;display-name=Viewer${userId};emotes=;id=${id};` +
        `room-id=1;tmi-sent-ts=1790000000000;user-id=${userId};user-type= ` +
        `:viewer${userId}!viewer${userId}@viewer${userId}.tmi.twitch.tv ${command} #${channel} :${text}`
    );
}

export function joinEcho(nick: string, channel: string): string {
    return `:${nick}!${nick}@${nick}.tmi.twitch.tv JOIN #${channel}`;
}

export function partEcho(nick: string, channel: string): string {
    return `:${nick}!${nick}@${nick}.tmi.twitch.tv PART #${channel}`;
}

export function roomstate(channel: string, tags = "emote-only=0;followers-only=-1;r9k=0"): string {
    return `@${tags};room-id=1;slow=0;subs-only=0 :tmi.twitch.tv ROOMSTATE #${channel}`;
}

/** A timeout or ban of one user. */
export function clearUser(channel: string, userId: string): string {
    return (
        `@ban-duration=600;room-id=1;target-user-id=${userId};tmi-sent-ts=1790000000000 ` +
        `:tmi.twitch.tv CLEARCHAT #${channel} :viewer${userId}`
    );
}

/** A moderator cleared the whole chat. */
export function clearRoom(channel: string): string {
    return `@room-id=1;tmi-sent-ts=1790000000000 :tmi.twitch.tv CLEARCHAT #${channel}`;
}

export function clearMessage(channel: string, id: string): string {
    return (
        `@login=viewer1001;room-id=;target-msg-id=${id};tmi-sent-ts=1790000000000 ` +
        `:tmi.twitch.tv CLEARMSG #${channel} :synthetic line ${id}`
    );
}

export function notice(channel: string, id = "msg_channel_suspended"): string {
    return `@msg-id=${id} :tmi.twitch.tv NOTICE #${channel} :This channel does not exist or has been suspended.`;
}

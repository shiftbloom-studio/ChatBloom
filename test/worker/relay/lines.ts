/** Synthetic IRC lines in the form Twitch sends them. None of them is a captured one. */

export function chatLine(channel: string, id: string, userId = "1001"): string {
    const user = `viewer${userId}`;
    return (
        `@badge-info=;badges=;color=#1E90FF;display-name=Viewer${userId};emotes=;id=${id};` +
        `room-id=1;tmi-sent-ts=1790000000000;user-id=${userId};user-type= ` +
        `:${user}!${user}@${user}.tmi.twitch.tv PRIVMSG #${channel} :synthetic line ${id}`
    );
}

export function joinEcho(nick: string, channel: string, command = "JOIN"): string {
    return `:${nick}!${nick}@${nick}.tmi.twitch.tv ${command} #${channel}`;
}

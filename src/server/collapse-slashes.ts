import { defineHandler, redirect } from "nitro/h3";

// The router matches no route, not even the 404 page, for a path with an empty segment such
// as `/chat//forsen`, and the app would answer 200 with an empty page. Redirect to the
// path with single slashes instead. The target always starts with exactly one slash, so it
// cannot point to another host.
export default defineHandler((event) => {
    const { pathname, search } = event.url;
    if (pathname.includes("//")) {
        return redirect(pathname.replace(/\/{2,}/g, "/") + search, 307, "Temporary Redirect");
    }
});

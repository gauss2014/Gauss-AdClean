# Quantumult X YouTube

Version: qx-v0.1.0. Add this resource under Rewrite, not as a whole configuration:

https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/main/modules/Gauss-YouTube-QX.snippet

Keep resource parsing OFF: the resource is already native QX format.
Enable the resource, Rewrite and MitM. Keep the installed and trusted QX CA.
No need to replace routing, nodes, DNS or the main configuration.
Quit YouTube completely, reopen and test the homepage, related cards and a video.

The resource includes its MitM hostnames and two rewrite rules. The script URL is
pinned to qx-v0.1.0. Script execution stays on the phone, without network APIs or
external Workers. Its 2 MiB cap, unknown-field preservation and playback flags
are inherited from the existing local ad-only core.

Initial local notifications/logs distinguish FILTERED, NO_MATCH, HTTP_SKIP,
BODY_SKIP, SIZE_SKIP and PROTOBUF_ERROR. They contain endpoint type and counts,
not account data, request query strings or response bodies.

Phone effectiveness is pending: this adapts the existing protobuf filter, not
a new solution for all YouTube ad formats. player/ad_break and UMP rewriting
are not implemented. If ads remain, use QX HTTP Analyzer to identify the exact
unhandled request and script result. No repeated Shadowrocket connection-only DBs.
To undo this stage, disable this one rewrite resource.

Sources:
- https://raw.githubusercontent.com/crossutility/Quantumult-X/master/sample.conf
- https://raw.githubusercontent.com/crossutility/Quantumult-X/master/sample-import-rewrite.snippet
- https://raw.githubusercontent.com/crossutility/Quantumult-X/master/sample-bytes-rewrite.js

Build: `node tools/build_qx_youtube.js`
Test: `node --test tools/test_qx_youtube.js tools/test_youtube_local.js`
The existing Shadowrocket module remains unchanged.

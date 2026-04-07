Project-local Cloudflare tunnel files live here.

Setup:

1. Copy `config.yml.example` to `config.yml`.
2. Replace `YOUR_TUNNEL_ID` with the tunnel UUID from Cloudflare Zero Trust.
3. Replace `YOUR_HOSTNAME` with the public hostname routed to this app.
4. Put the downloaded tunnel credential JSON in this folder and name it `<TUNNEL_ID>.json`.
5. If your repo path is not `C:\Documents\GitHub\Naviga-bot`, update `credentials-file` to the correct absolute Windows path.

This project serves the web app on `http://localhost:3001` by default, so the tunnel points there.

Run together:

```powershell
npm run dev:public
```

Or run separately:

1. Start the local web app with `npm run dev:web`.
2. Start the tunnel with `npm run tunnel`.

Direct command:

```powershell
cloudflared --config ./cloudflare/config.yml tunnel run naviga-tunnel
```

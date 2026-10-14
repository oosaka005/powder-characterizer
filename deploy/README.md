# Raspberry Pi deployment

## Recommended Balance USB policy

Powder-flow has one Balance and normally one USB-serial device, so it does not
need the Formulation Cell's multi-device `servers.toml` and templated systemd
units. It uses the same proven identification principle in a smaller form:

- reserve one physical Raspberry Pi USB port for the Balance;
- create the stable logical name `/dev/ttyUSB-balance` with udev;
- make both production and legacy Balance code use that logical name; and
- bind the existing Balance service to the udev device so unplugging stops the
  service and reconnecting to the reserved port starts it again.

The USB-to-serial cable is not part of the identity and may be replaced. A
different USB-serial device connected to the reserved port would receive the
same logical name, because a physical-port rule cannot identify the protocol.
The final acceptance check must therefore include an actual Balance status and
weight read, not only the existence of the device link.

1. Use the existing repository at `/home/sdl-5/powder-flow` and its `.venv`.
   After pulling an update, install `requirements.txt` into that environment.
2. Keep the existing Balance Server repository at
   `/home/sdl-5/balance_sila_server`. The included `balance-sila-server.service`
   starts that existing server on `127.0.0.1:50052`; no replacement Balance
   Server is created. Run the included idempotent configurator once so that the
   server opens the stable device path instead of `/dev/ttyUSB0` and replaces
   only its fixed two-second pre-read delay with the Formulation Cell watched
   stability policy:

   ```bash
   python3 /home/sdl-5/powder-flow/deploy/configure_balance_server.py --check
   python3 /home/sdl-5/powder-flow/deploy/configure_balance_server.py
   ```

   The watched read samples immediately every 0.5 seconds. It accepts the newest
   reading when the complete trailing 2-second window spans no more than 0.005 g.
   If the balance does not settle within 15 seconds, it logs a warning and uses
   the newest available reading, matching the Formulation Cell policy. The
   configurator validates the known Balance source before changing either file
   and reports `Already configured` on later runs. Restart
   `balance-sila-server.service` after configuring. The configurator also makes
   the existing gRPC shutdown handler pass `grace=0`, so `systemctl stop` exits
   cleanly instead of recording a false service failure. Do not launch the
   formulation-cell powder dispenser server for the same Motor Bonnet.
3. Keep the Balance USB-to-serial adapter connected to the designated physical
   USB port. This deployment uses the same physical-port policy as the
   Formulation Cell. On `dispensercontroller`, the observed by-path entry is
   confirmed as the direct USB port `KERNELS=="3-1"`. Confirm the udev ancestry
   before installation:

   ```bash
   udevadm info -a -n /dev/ttyUSB0 | grep 'KERNELS=='
   ```

   Use the USB-device entry without the interface suffix (for example `3-1`,
   not `3-1:1.0`). If it differs from `3-1`, update `KERNELS` in
   `udev/99-powder-flow.rules`. The adapter cable may be replaced, but the
   physical Raspberry Pi USB port must remain the same.
4. Copy `powder-flow.env.example` to `/etc/powder-flow.env` and adjust hosts or
   ports if required. Do not put I2C addresses in this file.
5. Install the systemd units and udev rule, then reload both managers. The final
   `readlink` command must resolve to the Balance adapter:

   ```bash
   cd /home/sdl-5/powder-flow/deploy
   sudo systemctl stop balance-sila-server.service
   sudo install -m 0644 systemd/*.service systemd/*.target /etc/systemd/system/
   sudo install -m 0644 udev/99-powder-flow.rules /etc/udev/rules.d/99-powder-flow.rules
   sudo systemctl daemon-reload
   sudo udevadm control --reload-rules
   sudo systemctl reset-failed balance-sila-server.service
   sudo udevadm trigger --action=add --subsystem-match=tty
   sudo systemctl enable --now powder-flow.target
   readlink -f /dev/ttyUSB-balance
   ```

   Enable `powder-flow-kiosk.service` only on an RPi with a local display and
   Chromium installed.
6. Confirm the first-layer server states, then open
   `http://dispensercontroller.local:8000` from a laptop.

The Balance service is bound to the fixed udev device. Removing the Balance
cable stops the service; reconnecting it to the designated port starts the
service again. Verify both the mapping and an actual Balance read after
installation:

```bash
readlink -f /dev/ttyUSB-balance
systemctl status balance-sila-server.service --no-pager -l
journalctl -u balance-sila-server.service -n 50 --no-pager
cd /home/sdl-5/powder-flow
.venv/bin/python - <<'PY'
from sila2.client import SilaClient

client = SilaClient("127.0.0.1", 50052, insecure=True)
try:
    print("status:", client.Balance.Status.get())
    print("weight:", client.Balance.ReadWeight().Weight)
finally:
    client.close()
PY
```

The service account needs access to I2C, GPIO, camera, and the existing
configuration/log/output paths. Only the dispenser server process may own the
Motor Bonnet; it also takes an inter-process lock at
`/tmp/powder-characterizer-dispenser.lock` by default.

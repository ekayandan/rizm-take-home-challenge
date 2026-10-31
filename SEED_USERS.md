# Seeded logins

`npm run seed` creates these users from `data/users.json`. Passwords are stored only as
salted scrypt hashes; the plain values below are the development defaults from that file.

| Name          | Email                       | Password        | Role     | Sites                |
|---------------|-----------------------------|-----------------|----------|----------------------|
| Jonas Weber   | jonas.weber@example.com     | `admin-2026`    | admin    | nordwerk, suedwerk   |
| Lena Hartmann | lena.hartmann@example.com   | `operator-2026` | operator | nordwerk             |
| Tarek Yilmaz  | tarek.yilmaz@example.com    | `operator-2026` | operator | suedwerk             |
| Petra Koch    | petra.koch@example.com      | `viewer-2026`   | viewer   | nordwerk             |

Each user sees only the sites assigned to them; admins see every site. The only write
action is adding a maintenance window on the hall day view, which `admin` and `operator`
may do; a `viewer` sees the windows but not the form.

Sessions last 8 hours (HttpOnly, SameSite=Lax cookie `hvac_session`). Set `COOKIE_SECURE=1`
when serving over HTTPS to add the `Secure` flag. Re-running `npm run seed` recreates the
database and so logs everyone out.

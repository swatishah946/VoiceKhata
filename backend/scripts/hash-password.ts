/**
 * Prints a bcrypt hash for the dashboard password.
 * Put the output in DASHBOARD_PASSWORD_HASH (and remove DASHBOARD_PASSWORD).
 *
 * Usage: npm run hash-password -- "my long dashboard password"
 */
import bcrypt from 'bcryptjs';

const password = process.argv[2];
if (!password || password.length < 10) {
  console.error('Usage: npm run hash-password -- "<password of at least 10 characters>"');
  process.exit(1);
}
console.log(bcrypt.hashSync(password, 12));

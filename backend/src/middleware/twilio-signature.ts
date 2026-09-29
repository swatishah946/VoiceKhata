import { NextFunction, Request, Response } from 'express';
import twilio from 'twilio';
import { config } from '../config';

/**
 * SECURITY FIX: verify that a webhook request really comes from Twilio.
 *
 * Twilio signs every request with our auth token (HMAC-SHA1 over the full URL +
 * the POST parameters) and sends it in the X-Twilio-Signature header. Without
 * this check, anyone who found the webhook URL could post fake messages.
 *
 * The URL must be the PUBLIC one Twilio called, so it is built from
 * PUBLIC_BASE_URL (Render terminates HTTPS in front of us, so req.protocol is
 * "http" and would never match).
 */
export function verifyTwilioSignature(req: Request, res: Response, next: NextFunction) {
  if (!config.TWILIO_VALIDATE_SIGNATURE) return next();

  const signature = req.header('X-Twilio-Signature');
  const url = config.publicBaseUrl + req.originalUrl;

  if (!signature || !twilio.validateRequest(config.TWILIO_AUTH_TOKEN!, signature, url, req.body || {})) {
    console.warn(`🚫 rejected webhook with invalid Twilio signature from ${req.ip}`);
    return res.status(403).send('Invalid signature');
  }
  next();
}

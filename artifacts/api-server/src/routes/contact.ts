import { Router } from "express";
import {
  CreateContactMessageBody,
  CreateContactMessageResponse,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate.js";
import { submitContactMessage } from "../services/contact.service.js";
import type { CreateContactInput } from "../lib/notion/contact.blocks.js";

const router = Router();

router.post(
  "/contact",
  validate({ body: CreateContactMessageBody }),
  async (_req, res) => {
    const body = res.locals.body as CreateContactInput;
    const result = await submitContactMessage(body);
    res.status(201).json(CreateContactMessageResponse.parse(result));
  },
);

export default router;

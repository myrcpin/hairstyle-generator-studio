import { HttpError, readJson, serve } from "../_shared/http.ts";
import { requireUser } from "../_shared/db.ts";
import { analyse, createProject, projectUrls, saveProject, deleteProject } from "./projects.ts";
import { alter, generate, generateAnother } from "./generate.ts";
import { emailCard, getCard, revokeCard, selectStyle, shareCard } from "./cards.ts";
import { allowance, claim, deleteAccount } from "./account.ts";
import { attachReferral, getReferral, getSurvey, submitSurvey } from "./growth.ts";

type Handler = (req: Request, user: Awaited<ReturnType<typeof requireUser>>, body: Record<string, unknown>) => Promise<Response>;

const actions: Record<string, Handler> = {
  create_project: createProject,
  analyse,
  generate,
  generate_another: generateAnother,
  alter,
  urls: projectUrls,
  select: selectStyle,
  card: getCard,
  email_card: emailCard,
  revoke_card: revokeCard,
  share_card: shareCard,
  save_project: saveProject,
  delete_project: deleteProject,
  delete_account: deleteAccount,
  allowance,
  claim,
  get_survey: getSurvey,
  submit_survey: submitSurvey,
  get_referral: getReferral,
  attach_referral: attachReferral,
};

serve(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "invalid_input");
  const body = await readJson(req);
  const handler = actions[String(body.action)];
  if (!handler) throw new HttpError(400, "invalid_input");
  const user = await requireUser(req);
  return handler(req, user, body);
});

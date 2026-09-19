/**
 * renasce — AI Protocol Calibration & Validation Engine
 * Generates prompt templates for external LLMs (zero runtime AI / zero keys required)
 * and validates the returned structured clinical JSON protocol.
 */

/**
 * Generates an expert dermatologist prompt template from user intake answers
 */
export function generateCalibrationPrompt({
  goals = '',
  products = '',
  sensitiveProduct = '',
  skinType = 'Normal / Combination'
} = {}) {
  const cleanGoals = goals.trim() || 'Barrier maintenance, daily sun protection, and acne prevention';
  const cleanProducts = products.trim() || 'Gentle cleanser, hydrating moisturizer, mineral sunscreen';
  const cleanSensitive = sensitiveProduct.trim() || 'None';
  const cleanSkinType = skinType.trim() || 'Normal / Combination';

  return `You are an expert cosmetic dermatologist and behavioral medicine specialist calibrating a digital skincare habit tracker named "renasce" (https://renasce.vercel.app).

The tracker operates on human circadian sleep cycles (After Sleep routine & Before Sleep routine) and calculates habit consistency via a biologically grounded Progress Score based on human epidermal turnover dynamics:
- Asymptotic compliance growth: ΔP = (1 - e^(-1/tau_gain)) * (100 - P)
- Exponential miss decay: P_decayed = P * e^(-elapsedDays/tau_decay)
- Stratum corneum desquamation typically occurs over 28–60 days (Grove & Kligman 1983; Leyden et al.).
- For potent actives (retinoids, direct acids), the tracker supports an adaptive titration schedule alternating active treatment nights and intentional barrier recovery nights until skin tolerance is reached.

USER PROFILE:
- Skin Type & Sensitivity: ${cleanSkinType}
- Clinical Goals: ${cleanGoals}
- Available Products / Formulations: ${cleanProducts}
- Product Requiring Gradual Acclimation (if any): ${cleanSensitive}

YOUR CLINICAL TASKS:
1. Review the available products. Identify active ingredients and ensure no harmful collisions (e.g. do not mix retinoids with strong direct AHAs/BHAs or leave-on benzoyl peroxide in the same application).
2. Construct the "After Sleep" routine (cleanser, barrier defenses/antioxidants, moisturizer, broad-spectrum sunscreen).
3. Construct the "Before Sleep" routine.
4. Determine whether an active product requires a gradual titration ramp-up (has_titration_schedule: true). If true:
   - Provide product name and short name for UI badges
   - Define active night steps (e.g. "Wash → Active → Moisturizer")
   - Define rest night steps (e.g. "Wash → Moisturizer only")
   - Provide active night subtext and rest night subtext
   - Specify application count milestones for phase transitions (e.g. [7, 21] active applications)
5. Calibrate progress_gain_tau_days and progress_decay_tau_days (typically 45–75 days, based on published clinical timelines for epidermal remodeling and cellular turnover for these specific ingredients).
6. Provide a concise 2–3 sentence clinical rationale with literature citations (e.g., Kligman, Leyden, Kang et al.) in "sources_summary".

OUTPUT INSTRUCTIONS:
You MUST respond with VALID JSON ONLY. Do not include markdown code fences, greetings, or explanations outside the JSON object.
Output EXACTLY this JSON structure:
{
  "routine_config": {
    "afterSleep": {
      "title": "After Sleep Routine",
      "steps": ["Step 1", "Step 2", "Step 3"],
      "subtext": "Brief clinical rationale for morning sequence."
    },
    "beforeSleep": {
      "title": "Before Sleep Routine",
      "steps": ["Step 1", "Step 2", "Step 3"],
      "titration": {
        "productName": "Product Full Name",
        "productShort": "ShortBadgeName",
        "activeSteps": "Wash → Active → Moisturizer",
        "restSteps": "Wash → Moisturizer only",
        "activeSubtext": "Clinical guidance for active treatment nights.",
        "restSubtext": "Clinical guidance for barrier recovery nights.",
        "phaseNames": ["Acclimation", "Building Nightly", "Maintenance"]
      }
    }
  },
  "has_titration_schedule": true,
  "titration_phase_thresholds": [7, 21],
  "progress_gain_tau_days": 60,
  "progress_decay_tau_days": 58,
  "sources_summary": "1-3 sentences with specific published clinical literature backing the turnover timeline and active ingredient protocol."
}`;
}

/**
 * Validates and normalizes the JSON payload pasted back by the user
 */
export function validateCalibrationPayload(input) {
  if (!input) {
    return { valid: false, error: 'Input is empty. Please paste the JSON response from your AI model.' };
  }

  let parsed = null;
  if (typeof input === 'object') {
    parsed = input;
  } else if (typeof input === 'string') {
    let cleaned = input.trim();
    // Strip markdown code fences if present (```json ... ``` or ``` ...)
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return { valid: false, error: `Invalid JSON syntax: ${e.message}. Ensure you copied only the JSON structure.` };
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, error: 'Root payload must be a JSON object.' };
  }

  const routine = parsed.routine_config;
  if (!routine || typeof routine !== 'object') {
    return { valid: false, error: 'Missing "routine_config" object.' };
  }

  // Validate afterSleep
  if (!routine.afterSleep || !Array.isArray(routine.afterSleep.steps) || routine.afterSleep.steps.length === 0) {
    return { valid: false, error: '"routine_config.afterSleep.steps" must be an array with at least 1 step.' };
  }
  const cleanAfterSteps = routine.afterSleep.steps.map(s => String(s).trim()).filter(Boolean);
  if (cleanAfterSteps.length === 0) {
    return { valid: false, error: 'After Sleep steps cannot be empty.' };
  }

  // Validate beforeSleep
  if (!routine.beforeSleep || !Array.isArray(routine.beforeSleep.steps) || routine.beforeSleep.steps.length === 0) {
    return { valid: false, error: '"routine_config.beforeSleep.steps" must be an array with at least 1 step.' };
  }
  const cleanBeforeSteps = routine.beforeSleep.steps.map(s => String(s).trim()).filter(Boolean);
  if (cleanBeforeSteps.length === 0) {
    return { valid: false, error: 'Before Sleep steps cannot be empty.' };
  }

  // Validate has_titration_schedule
  const hasTitration = Boolean(parsed.has_titration_schedule);

  // Validate titration config if enabled
  let cleanTitration = null;
  if (hasTitration) {
    const titr = routine.beforeSleep.titration;
    if (!titr || typeof titr !== 'object') {
      return { valid: false, error: 'has_titration_schedule is true, but "routine_config.beforeSleep.titration" is missing or invalid.' };
    }
    if (!titr.productName || !titr.productShort) {
      return { valid: false, error: 'Titration configuration requires "productName" and "productShort".' };
    }
    cleanTitration = {
      productName: String(titr.productName).trim(),
      productShort: String(titr.productShort).trim(),
      activeSteps: String(titr.activeSteps || cleanBeforeSteps.join(' → ')).trim(),
      restSteps: String(titr.restSteps || 'Wash → Moisturizer only').trim(),
      activeSubtext: String(titr.activeSubtext || 'Active treatment night.').trim(),
      restSubtext: String(titr.restSubtext || 'Intentional barrier recovery night.').trim(),
      phaseNames: Array.isArray(titr.phaseNames) && titr.phaseNames.length >= 2
        ? titr.phaseNames.map(p => String(p).trim())
        : ['Acclimation', 'Building Nightly', 'Maintenance']
    };
  }

  // Validate titration phase thresholds
  let thresholds = [7, 21];
  if (Array.isArray(parsed.titration_phase_thresholds) && parsed.titration_phase_thresholds.length >= 2) {
    const t1 = Math.round(Number(parsed.titration_phase_thresholds[0]));
    const t2 = Math.round(Number(parsed.titration_phase_thresholds[1]));
    if (!isNaN(t1) && !isNaN(t2) && t1 > 0 && t2 > t1) {
      thresholds = [t1, t2];
    }
  }

  // Validate tau parameters (clamp to clinically plausible range 14 to 180 days)
  let tauGain = Math.round(Number(parsed.progress_gain_tau_days));
  if (isNaN(tauGain) || tauGain < 14 || tauGain > 180) {
    tauGain = 60;
  }

  let tauDecay = Math.round(Number(parsed.progress_decay_tau_days));
  if (isNaN(tauDecay) || tauDecay < 14 || tauDecay > 180) {
    tauDecay = 58;
  }

  // Validate sources summary
  const sourcesSummary = typeof parsed.sources_summary === 'string'
    ? parsed.sources_summary.trim()
    : '';

  const validatedRoutineConfig = {
    afterSleep: {
      title: String(routine.afterSleep.title || 'After Sleep Routine').trim(),
      steps: cleanAfterSteps,
      subtext: String(routine.afterSleep.subtext || 'Daily barrier defense and protection.').trim()
    },
    beforeSleep: {
      title: String(routine.beforeSleep.title || 'Before Sleep Routine').trim(),
      steps: cleanBeforeSteps,
      ...(cleanTitration ? { titration: cleanTitration } : {})
    },
    sources_summary: sourcesSummary
  };

  return {
    valid: true,
    data: {
      routine_config: validatedRoutineConfig,
      has_titration_schedule: hasTitration,
      titration_phase_thresholds: thresholds,
      progress_gain_tau_days: tauGain,
      progress_decay_tau_days: tauDecay,
      sources_summary: sourcesSummary
    }
  };
}

import { z } from "zod";

/**
 * Only the fields we ask for in the field mask. Google omits keys entirely when
 * a place has no value for them, so nearly everything is optional — including
 * `websiteUri`, whose absence is the entire point of this product.
 */
export const placeSchema = z.object({
  id: z.string(),
  displayName: z
    .object({
      text: z.string().optional(),
      languageCode: z.string().optional(),
    })
    .optional(),
  formattedAddress: z.string().optional(),
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
    })
    .optional(),
  types: z.array(z.string()).optional(),
  businessStatus: z.string().optional(),
  nationalPhoneNumber: z.string().optional(),
  internationalPhoneNumber: z.string().optional(),
  websiteUri: z.string().optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().optional(),
});

export type Place = z.infer<typeof placeSchema>;

export const searchTextResponseSchema = z.object({
  places: z.array(placeSchema).optional(),
  nextPageToken: z.string().optional(),
});

export type SearchTextResponse = z.infer<typeof searchTextResponseSchema>;

/*
 * Topic rules the mock applies, mirrored from the "Topics" section of
 * docs/developer-guide/business-rules.mdx. Keep them in sync.
 */
import type { Questionnaire, Topic, TopicIcon } from '../../app/core/api/api-schema.gen';
import type { TopicRecord } from '../db/mock-data';

export const TOPIC_NAME_MAX_LENGTH = 100;
export const TOPIC_DESCRIPTION_MAX_LENGTH = 1000;

/** The curated icons a topic can have: `TopicIcon` in the spec. */
export const TOPIC_ICONS = [
  'fish',
  'key-round',
  'lock',
  'shield-check',
  'database',
  'file-lock',
  'eye-off',
  'users',
  'globe',
  'wifi',
  'network',
  'cloud',
  'laptop',
  'smartphone',
  'usb',
  'house',
  'bug',
] as const satisfies readonly TopicIcon[];

/** `questionnaireCount`: every questionnaire in the topic, active and inactive. */
export function questionnaireCount(
  topicId: string,
  questionnaires: readonly Pick<Questionnaire, 'topicId'>[],
): number {
  return questionnaires.filter((questionnaire) => questionnaire.topicId === topicId).length;
}

/** The API's `Topic`: the stored record plus its derived `questionnaireCount`. */
export function toTopic(
  record: TopicRecord,
  questionnaires: readonly Pick<Questionnaire, 'topicId'>[],
): Topic {
  return { ...record, questionnaireCount: questionnaireCount(record.id, questionnaires) };
}

/**
 * Names are unique within the organization, among active and inactive topics, ignoring upper and
 * lower case and spaces around them.
 */
export function isSameTopicName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

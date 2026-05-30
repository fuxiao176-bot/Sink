<script setup lang="ts">
import type { Link, LinkFormData } from '@/types'
import { LinkSchema, nanoid } from '#shared/schemas/link'
import { isMaskedLinkPassword } from '#shared/utils/link-password'
import { useForm } from '@tanstack/vue-form'
import { Plus, Shuffle, Sparkles, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { z } from 'zod'

const props = defineProps<{
  link: Partial<Link>
  isEdit: boolean
}>()

const emit = defineEmits<{
  success: [link: Link]
}>()

const { t } = useI18n()

const urlValidator = LinkSchema.shape.url
const slugValidator = LinkSchema.shape.slug
const commentValidator = z.string().max(500).optional()
const optionalUrlValidator = z.string().trim().url().max(2048).optional().or(z.literal(''))

const generateSlug = nanoid()

function getPasswordSubmitValue(password: string): string | undefined {
  if (isMaskedLinkPassword(password))
    return undefined

  if (password === '')
    return props.isEdit ? '' : undefined

  return password
}

const form = useForm({
  defaultValues: {
    url: props.link.url ?? '',
    slug: props.link.slug ?? '',
    comment: props.link.comment ?? '',
    expiration: props.link.expiration
      ? unix2date(props.link.expiration)
      : undefined,
    google: props.link.google ?? '',
    apple: props.link.apple ?? '',
    title: props.link.title ?? '',
    description: props.link.description ?? '',
    image: props.link.image ?? '',
    cloaking: props.link.cloaking ?? false,
    redirectWithQuery: props.link.redirectWithQuery ?? false,
    password: props.link.password ?? '',
    unsafe: props.link.unsafe ?? false,
    geo: props.link.geo ? Object.entries(props.link.geo).map(([country, url]) => ({ country, url })) : [],
    urls: props.link.urls ?? [],
  } satisfies LinkFormData,
  onSubmit: async ({ value }) => {
    try {
      const geoRecord: Record<string, string> = {}
      value.geo?.forEach((g) => {
        const country = g.country.trim().toUpperCase()
        const url = g.url.trim()
        if (country && url) {
          geoRecord[country] = url
        }
      })
      const linkData = {
        url: value.url,
        slug: value.slug,
        comment: value.comment || undefined,
        expiration: value.expiration
          ? date2unix(value.expiration, 'end')
          : undefined,
        google: value.google || undefined,
        apple: value.apple || undefined,
        title: value.title || undefined,
        description: value.description || undefined,
        image: value.image || undefined,
        cloaking: value.cloaking,
        redirectWithQuery: value.redirectWithQuery,
        password: getPasswordSubmitValue(value.password),
        unsafe: props.isEdit ? value.unsafe : value.unsafe || undefined,
        geo: Object.keys(geoRecord).length > 0 ? geoRecord : undefined,
        urls: value.urls?.filter(u => u.trim())?.length > 0 ? value.urls.filter(u => u.trim()) : undefined,
      }
      const { link: newLink } = await useAPI<{ link: Link }>(
        props.isEdit ? '/api/link/edit' : '/api/link/create',
        {
          method: props.isEdit ? 'PUT' : 'POST',
          body: linkData,
        },
      )
      emit('success', newLink)
      toast(props.isEdit ? t('links.update_success') : t('links.create_success'))
    }
    catch (error) {
      console.error(error)
      toast.error(props.isEdit ? t('links.update_failed') : t('links.create_failed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  },
})

const validateUrl = makeZodValidator(urlValidator)
const validateSlug = makeZodValidator(slugValidator)
const validateComment = makeZodValidator(commentValidator)
const validateOptionalUrl = makeZodValidator(optionalUrlValidator)

const utmBuilderOpen = ref(false)
const { isInvalid, getAriaInvalid } = useFieldHelpers()

function formatErrors(errors: unknown[]): string[] {
  return errors
    .map((e) => {
      if (typeof e === 'string')
        return e
      if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string')
        return e.message
      return null
    })
    .filter((m): m is string => m !== null)
}

function randomSlug() {
  form.setFieldValue('slug', generateSlug())
}

const aiSlugPending = ref(false)
async function aiSlug() {
  const url = form.getFieldValue('url')
  if (!url)
    return

  aiSlugPending.value = true
  try {
    const result = await useAPI<{ slug: string }>('/api/link/ai', {
      query: { url },
    })
    form.setFieldValue('slug', result.slug)
  }
  catch (error) {
    console.error(error)
    toast.error(t('links.ai_slug_failed'), {
      description: error instanceof Error ? error.message : String(error),
    })
  }
  finally {
    aiSlugPending.value = false
  }
}

const currentSlug = form.useStore(state => state.values.slug || '')
const currentUrl = form.useStore(state => state.values.url || '')
const currentUrls = form.useStore(state => state.values.urls || [])

// Load per-URL click stats in edit mode
const clickStats = ref<Record<string, number>>({})
const statsLoading = ref(false)
if (props.isEdit && props.link.slug && props.link.urls && props.link.urls.length > 1) {
  statsLoading.value = true
  useAPI<{ stats: Record<string, number> }>('/api/link/rr-stats', {
    query: { slug: props.link.slug },
  }).then((result) => {
    clickStats.value = result.stats || {}
  }).catch(() => {
    // stats are optional, silently ignore
  }).finally(() => {
    statsLoading.value = false
  })
}

const { previewMode } = useRuntimeConfig().public

async function applyUtmUrl(url: string) {
  form.setFieldValue('url', url)
  await form.validateField('url', 'blur')
}

defineExpose({ randomSlug })
</script>

<template>
  <form
    id="link-editor-form"
    class="w-full space-y-4 px-1"
    @submit.prevent="form.handleSubmit"
  >
    <p
      v-if="previewMode"
      class="text-sm text-muted-foreground"
    >
      {{ $t('links.preview_mode_tip') }}
    </p>

    <FieldGroup>
      <form.Field
        v-slot="{ field }"
        name="url"
        :validators="{ onBlur: validateUrl, onSubmit: validateUrl }"
      >
        <Field :data-invalid="isInvalid(field)">
          <div class="flex items-center justify-between">
            <FieldLabel :for="field.name">
              {{ $t('links.form.url') }}
            </FieldLabel>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="h-6 px-2 text-xs font-medium"
              aria-label="Open UTM builder"
              @click="utmBuilderOpen = true"
            >
              UTM
            </Button>
          </div>
          <Input
            :id="field.name"
            :name="field.name"
            :model-value="field.state.value"
            :aria-invalid="getAriaInvalid(field)"
            placeholder="https://example.com"
            autocomplete="url"
            @blur="field.handleBlur"
            @input="field.handleChange(($event.target as HTMLInputElement).value)"
          />
          <FieldError
            v-if="isInvalid(field)"
            :errors="formatErrors(field.state.meta.errors)"
          />
        </Field>
      </form.Field>

      <!-- Round-Robin Multi-URL -->
      <form.Field v-slot="{ field }" name="urls">
        <div class="rounded-md border border-dashed p-3">
          <div class="mb-2 flex items-center justify-between">
            <p class="text-xs font-medium text-muted-foreground">
              {{ $t('links.form.roundrobin_urls_label') }}
              <span class="font-normal text-muted-foreground/60">— {{ $t('links.form.roundrobin_urls_description') }}</span>
            </p>
            <span
              v-if="field.state.value.filter((u: string) => u.trim()).length >= 2"
              class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            >
              <Shuffle class="h-3 w-3" />
              {{ $t('links.form.roundrobin_mode_auto') }}
            </span>
            <span
              v-else-if="field.state.value.filter((u: string) => u.trim()).length === 1"
              class="text-xs text-muted-foreground"
            >
              {{ $t('links.form.roundrobin_mode_single_hint') }}
            </span>
          </div>
          <div class="space-y-1.5">
            <div
              v-for="(urlItem, idx) of field.state.value" :key="idx"
              class="flex items-center gap-1.5"
            >
              <span class="w-4 shrink-0 text-xs text-muted-foreground">{{ idx + 1 }}</span>
              <Input
                :model-value="urlItem"
                :placeholder="$t('links.form.roundrobin_url_placeholder')"
                autocomplete="url"
                class="h-8 flex-1 text-sm"
                @input="field.handleChange(field.state.value.map((u: string, i: number) => i === idx ? ($event.target as any).value : u))"
              />
              <span
                v-if="isEdit && clickStats[String(idx)] !== undefined"
                class="w-14 shrink-0 text-right text-xs text-muted-foreground"
              >
                {{ clickStats[String(idx)] }} {{ $t('links.form.roundrobin_clicks') }}
              </span>
              <Button
                type="button" variant="ghost" size="icon" class="
                  h-8 w-8 shrink-0
                " @click="field.handleChange(field.state.value.filter((_: string, i: number) => i !== idx))"
              >
                <Trash2 class="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </div>
          </div>
          <Button
            type="button" variant="ghost" size="sm" class="mt-2 h-7 text-xs" @click="field.handleChange([...field.state.value, ''])"
          >
            <Plus class="mr-1 h-3.5 w-3.5" /> {{ $t('links.form.roundrobin_add_url') }}
          </Button>
        </div>
      </form.Field>

      <form.Field
        v-slot="{ field }"
        name="slug"
        :validators="{ onBlur: validateSlug, onSubmit: validateSlug }"
      >
        <Field :data-invalid="isInvalid(field)">
          <div class="flex items-center justify-between">
            <FieldLabel :for="field.name">
              {{ $t('links.form.slug') }}
            </FieldLabel>
            <div v-if="!isEdit" class="flex space-x-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="h-auto w-auto p-0"
                aria-label="Generate random slug"
                @click="randomSlug"
              >
                <Shuffle class="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="h-auto w-auto p-0"
                aria-label="Generate AI slug"
                :disabled="aiSlugPending"
                @click="aiSlug"
              >
                <Sparkles
                  class="h-4 w-4"
                  :class="{ 'animate-bounce': aiSlugPending }"
                />
              </Button>
            </div>
          </div>
          <Input
            :id="field.name"
            :name="field.name"
            :model-value="field.state.value"
            :disabled="isEdit"
            :aria-invalid="getAriaInvalid(field)"
            placeholder="my-short-link"
            autocomplete="off"
            @blur="field.handleBlur"
            @input="field.handleChange(($event.target as HTMLInputElement).value)"
          />
          <FieldError
            v-if="isInvalid(field)"
            :errors="formatErrors(field.state.meta.errors)"
          />
        </Field>
      </form.Field>

      <form.Field
        v-slot="{ field }"
        name="comment"
        :validators="{ onBlur: validateComment, onSubmit: validateComment }"
      >
        <DashboardLinksEditorFieldTextarea
          :field="field"
          :label="$t('links.form.comment')"
          :invalid="isInvalid(field)"
          :aria-invalid="getAriaInvalid(field)"
          :errors="formatErrors(field.state.meta.errors)"
        />
      </form.Field>
    </FieldGroup>

    <DashboardLinksEditorAdvanced
      :form="form"
      :validate-optional-url="validateOptionalUrl"
      :is-invalid="isInvalid"
      :get-aria-invalid="getAriaInvalid"
      :format-errors="formatErrors"
      :current-slug="currentSlug"
      :is-edit="isEdit"
    />
  </form>

  <DashboardLinksEditorUtmBuilder
    v-model:open="utmBuilderOpen"
    :url="currentUrl"
    @apply="applyUtmUrl"
  />
</template>

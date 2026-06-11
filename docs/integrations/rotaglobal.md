# Integration: RotaGlobal

RotaGlobal consumes nearly every Rota Core module.

## Tracking script

```html
<script src="https://analytics.rota.app/track.js"></script>
<script>
  rota.track('scholarship_saved', { scholarshipId: 'sch-1' });
</script>
```

## Search indexing

```ts
const rota = createRotaCore({ serviceName: 'rotaglobal' });

// keep the index in sync from domain events
rota.events.consumer.on('scholarship.saved', async (event) => {
  await rota.search.indexDocument({
    id: event.targetId!,
    type: 'scholarship',
    title: event.payload.title as string,
    content: event.payload.description as string,
    tags: event.payload.tags as string[],
    source: 'rotaglobal',
  });
});

// user-facing search endpoint
const results = await rota.search.search(query, { type: ['scholarship', 'university'] });
```

## Feature flags

```ts
if (await rota.flags.isEnabled('new-forum', { userId, roles })) {
  renderNewForum();
}
```

## Forum notifications

Publishing `post.comment.created` (with `postAuthorId` in the payload)
automatically produces an in-app forum notification via the default handlers.

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { Translate } = require('@google-cloud/translate').v2;
const fetch = require('node-fetch');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);
admin.initializeApp();

const db = admin.firestore();
const storage = admin.storage();
const translate = new Translate();

// Secure callable function with App Check
exports.translateMessage = functions
  .runWith({
    enforceAppCheck: true,
    memory: '256MB',
    timeoutSeconds: 60
  })
  .https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'User must be authenticated to use this feature.'
      );
    }

    // Validate input data
    if (!data.text || !data.targetLanguage) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Text and target language are required.'
      );
    }

    try {
      // Get user's translation limits
      const userRef = db.collection('users').doc(context.auth.uid);
      const userDoc = await userRef.get();
      const userData = userDoc.data();

      // Check translation limits
      if (userData.translationCount >= userData.translationLimit) {
        throw new functions.https.HttpsError(
          'resource-exhausted',
          'Daily translation limit reached.'
        );
      }

      // Perform translation
      const [translation] = await translate.translate(data.text, data.targetLanguage);

      // Update user's translation count
      await userRef.update({
        translationCount: admin.firestore.FieldValue.increment(1),
        lastTranslation: admin.firestore.Timestamp.now()
      });

      // Log translation for analytics
      await db.collection('translations').add({
        userId: context.auth.uid,
        appId: context.app.appId,
        originalText: data.text,
        translatedText: translation,
        sourceLanguage: data.sourceLanguage || 'auto',
        targetLanguage: data.targetLanguage,
        timestamp: admin.firestore.Timestamp.now()
      });

      return { translatedText: translation };
    } catch (error) {
      console.error('Translation error:', error);
      throw new functions.https.HttpsError(
        'internal',
        'Translation service error.',
        error
      );
    }
  });

// Secure file processing function with App Check
exports.processUploadedMedia = functions
  .runWith({
    enforceAppCheck: true,
    memory: '1GB',
    timeoutSeconds: 300
  })
  .storage.object()
  .onFinalize(async (object) => {
    if (!object.name || !object.contentType) return;

    try {
      // Verify file metadata
      const metadata = object.metadata || {};
      if (!metadata.userId) {
        throw new Error('User ID missing in file metadata');
      }

      // Process based on content type
      if (object.contentType.startsWith('image/')) {
        await processImage(object);
      } else if (object.contentType.startsWith('video/')) {
        await processVideo(object);
      }

      // Log successful processing
      await db.collection('mediaProcessing').add({
        fileId: object.name,
        userId: metadata.userId,
        contentType: object.contentType,
        size: object.size,
        timestamp: admin.firestore.Timestamp.now(),
        status: 'completed'
      });
    } catch (error) {
      console.error('Media processing error:', error);
      
      // Log processing error
      await db.collection('mediaProcessing').add({
        fileId: object.name,
        userId: object.metadata?.userId,
        contentType: object.contentType,
        size: object.size,
        timestamp: admin.firestore.Timestamp.now(),
        status: 'failed',
        error: error.message
      });
    }
  });

async function processImage(object) {
  const bucket = storage.bucket(object.bucket);
  const file = bucket.file(object.name);
  const tempFilePath = `/tmp/${object.name.split('/').pop()}`;

  // Download file
  await file.download({ destination: tempFilePath });

  // Generate thumbnail
  const thumbnail = await sharp(tempFilePath)
    .resize(300, 300, { fit: 'inside' })
    .toBuffer();

  // Upload thumbnail
  const thumbnailName = `thumbnails/${object.name.split('/').pop()}`;
  const thumbnailFile = bucket.file(thumbnailName);
  await thumbnailFile.save(thumbnail, {
    metadata: {
      contentType: object.contentType,
      metadata: object.metadata
    }
  });
}

async function processVideo(object) {
  const bucket = storage.bucket(object.bucket);
  const file = bucket.file(object.name);
  const tempFilePath = `/tmp/${object.name.split('/').pop()}`;
  const thumbnailPath = `/tmp/thumb_${object.name.split('/').pop()}.jpg`;

  // Download file
  await file.download({ destination: tempFilePath });

  // Generate thumbnail
  await new Promise((resolve, reject) => {
    ffmpeg(tempFilePath)
      .screenshots({
        timestamps: ['00:00:01'],
        filename: `thumb_${object.name.split('/').pop()}.jpg`,
        folder: '/tmp'
      })
      .on('end', resolve)
      .on('error', reject);
  });

  // Upload thumbnail
  const thumbnailName = `thumbnails/${object.name.split('/').pop()}.jpg`;
  const thumbnailFile = bucket.file(thumbnailName);
  await thumbnailFile.save(thumbnailPath, {
    metadata: {
      contentType: 'image/jpeg',
      metadata: object.metadata
    }
  });
}

// Cleanup Functions
exports.cleanupTempFiles = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async (context) => {
    const bucket = storage.bucket();
    const [files] = await bucket.getFiles({ prefix: 'temp/' });
    
    const now = Date.now();
    const deletePromises = files.map(async (file) => {
      const [metadata] = await file.getMetadata();
      const created = new Date(metadata.timeCreated).getTime();
      
      if (now - created > 24 * 60 * 60 * 1000) {
        return file.delete();
      }
    });
    
    await Promise.all(deletePromises);
  });

exports.cleanupExpiredStories = functions.pubsub
  .schedule('every 1 hours')
  .onRun(async (context) => {
    const now = admin.firestore.Timestamp.now();
    
    const expiredStories = await db.collection('stories')
      .where('expiresAt', '<=', now)
      .get();
      
    const deletePromises = expiredStories.docs.map(doc => doc.ref.delete());
    await Promise.all(deletePromises);
  });
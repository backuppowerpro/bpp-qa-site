/* Same approved ending shell, separate photo-later route. */
(function () {
  'use strict';
  BPPGuidedSaved.start('photos-later', function () {
    WALK.go('thankyou.html', WALK.token(), null, true);
  });
})();

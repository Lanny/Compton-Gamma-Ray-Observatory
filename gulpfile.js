const gulp = require('gulp')
const flatten = require('gulp-flatten')
const less = require('gulp-less')
const sourcemaps = require('gulp-sourcemaps')
const path = require('path')

function lessTask() {
  const lessStream = less({
    paths: [ path.join(__dirname, 'less') ]
  }).on('error', function(err) {
    console.error(err)
    this.emit('end')
  })

  return gulp.src('./client/less/*.less')
    .pipe(sourcemaps.init())
    .pipe(lessStream)
    .pipe(sourcemaps.write())
    .pipe(flatten())
    .pipe(gulp.dest('./client/css'))
}

gulp.task('less', gulp.series([], lessTask))

gulp.task('watch', gulp.series(['less'], () => {
  gulp.watch(['./client/less/*.less'], lessTask)
}))


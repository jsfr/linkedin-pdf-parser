import PDFParser from 'pdf2json'
import R from 'ramda'
import moment from 'moment-timezone'

const JOB_SEPERATOR = '  at  '
const DATE_SEPERATOR = '  -  '

const getHLines = R.compose(
  R.map(R.prop('y')),
  R.flatten,
  R.prop('HLines')
)

const getTexts = R.compose(
  R.slice(2, Infinity), // Remove 'Page [number]'
  R.prop('Texts')
)

const getRawTexts = R.compose(
  R.map(R.trim),
  R.map(decodeURIComponent),
  R.map(R.prop('T')),
  R.flatten,
  R.map(R.prop('R'))
)

const parseDate = str => {
  let date = new Date(str)
  if (!moment(date).isValid()) return undefined
  date.setUTCDate(1)
  date.setUTCHours(0, 0, 0, 0)
  return date
}

const isPosition = str => str.indexOf(JOB_SEPERATOR) !== -1

const getPositions = texts => {
  let positions = []

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]
    if (isPosition(text)) {
      const [ title, company ] = R.map(R.trim, text.split(JOB_SEPERATOR))
      const [ startDate, endDate ] = R.map(parseDate, texts[i + 1].split(DATE_SEPERATOR))
      positions.push({
        title,
        company,
        startDate,
        endDate,
        summary: []
      })
      i = i + 2 // jump past date and span
    } else {
      positions[positions.length - 1].summary.push(text)
    }
  }

  // Join together summary
  positions = R.map(
    pos => (Object.assign({}, pos, { summary: pos.summary.join('\n') }))
  )(positions)

  return positions
}

const parsePages = pages => {
  const hlinesPaged = R.map(getHLines, pages)
  const textsPaged = R.map(getTexts, pages)
  let groups = []

  // Groups texts according to hlines
  for (let i = 0; i < pages.length; i++) {
    const hlines = hlinesPaged[i]
    const texts = textsPaged[i]

    groups.push(R.groupBy(
      text => R.findIndex(hline => text.y < hline)(hlines),
      texts
    ))
  }

  // Combine groups below last hline on a page and above first hline on next page
  for (let i = 1; i < groups.length; i++) {
    if (!groups[i - 1]['-1'] || !groups[i]['0']) continue
    groups[i]['0'] = R.concat(groups[i - 1]['-1'], groups[i]['0'])
    delete groups[i - 1]['-1']
  }

  // Unnest pages and collect groups into a single array of groups,
  // then get the texts within each group
  groups = R.compose(
    R.map(getRawTexts),
    R.unnest,
    R.map(R.valuesIn)
  )(groups)

  // Get the sections we care about
  const sections = {}
  for (let i = 0; i < groups.length; i++) {
    const [ head, ...tail ] = groups[i]
    switch (head) {
      case 'Summary':
        sections.summary = tail.join('\n')
        break
      case 'Experience':
        sections.positions = getPositions(tail)
        break
      default:
        break
    }
  }

  // Last check before handing over
  if (!sections.positions) throw new Error('No positions have been found')

  return sections
}

const parse = (pdfBuffer) => {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser()
    pdfParser.on('pdfParser_dataReady', pdfData => {
      try {
        const data = parsePages(pdfData.formImage.Pages)
        resolve(data)
      } catch (err) {
        reject(err)
      }
    })
    pdfParser.on('pdfParser_dataError', errData => reject(errData))
    pdfParser.parseBuffer(pdfBuffer)
  })
}

export default parse

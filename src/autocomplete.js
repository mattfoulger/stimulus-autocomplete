import { Controller } from "@hotwired/stimulus"

const optionSelector = "[role='option']:not([aria-disabled])"
const activeSelector = "[aria-selected='true']"

export default class Autocomplete extends Controller {
  static targets = ["input", "hidden", "results"]
  static classes = ["selected"]
  static values = {
    ready: Boolean,
    submitOnEnter: Boolean,
    url: String,
    minLength: Number,
  }

  connect() {
    this.close()

    this.inputTarget.hasAttribute("autocomplete") || this.inputTarget.setAttribute("autocomplete", "off")
    this.inputTarget.setAttribute("spellcheck", "false")

    this.mouseDown = false

    this.inputTarget.addEventListener("keydown", this.onKeydown)
    this.inputTarget.addEventListener("blur", this.onInputBlur)
    this.inputTarget.addEventListener("input", this.onInputChange)
    this.resultsTarget.addEventListener("mousedown", this.onResultsMouseDown)
    this.resultsTarget.addEventListener("click", this.onResultsClick)

    if (typeof this.inputTarget.getAttribute("autofocus") === "string") {
      this.inputTarget.focus()
    }

    this.readyValue = true
  }

  disconnect() {
    if (this.hasInputTarget) {
      this.inputTarget.removeEventListener("keydown", this.onKeydown)
      this.inputTarget.removeEventListener("focus", this.onInputFocus)
      this.inputTarget.removeEventListener("blur", this.onInputBlur)
      this.inputTarget.removeEventListener("input", this.onInputChange)
    }
    if (this.hasResultsTarget) {
      this.resultsTarget.removeEventListener("mousedown", this.onResultsMouseDown)
      this.resultsTarget.removeEventListener("click", this.onResultsClick)
    }
  }

  sibling(next) {
    const options = this.options
    const selected = this.selectedOption
    const index = options.indexOf(selected)
    const sibling = next ? options[index + 1] : options[index - 1]
    const def = next ? options[0] : options[options.length - 1]
    return sibling || def
  }

  select(target) {
    const previouslySelected = this.selectedOption
    if (previouslySelected) {
      previouslySelected.removeAttribute("aria-selected")
      previouslySelected.classList.remove(...this.selectedClassesOrDefault)
    }

    target.setAttribute("aria-selected", "true")
    target.classList.add(...this.selectedClassesOrDefault)
    this.inputTarget.setAttribute("aria-activedescendant", target.id)
    target.scrollIntoView(false)
  }

  onKeydown = (event) => {
    switch (event.key) {
      case "Escape":
        if (!this.isHidden) {
          this.hideAndRemoveOptions()
          event.stopPropagation()
          event.preventDefault()
        }
        break
      case "ArrowDown":
        {
          const item = this.sibling(true)
          if (item) this.select(item)
          event.preventDefault()
        }
        break
      case "ArrowUp":
        {
          const item = this.sibling(false)
          if (item) this.select(item)
          event.preventDefault()
        }
        break
      case "Tab":
        {
          const selected = this.selectedOption
          if (selected) this.commit(selected)
        }
        break
      case "Enter":
        {
          const selected = this.selectedOption
          if (selected && !this.isHidden) {
            this.commit(selected)
            if (!this.hasSubmitOnEnterValue) {
              event.preventDefault()
            }
          }
        }
        break
    }
  }

  onInputBlur = () => {
    if (this.mouseDown) return
    this.close()
  }

  commit(selected) {
    if (selected.getAttribute("aria-disabled") === "true") return

    if (selected instanceof HTMLAnchorElement) {
      selected.click()
      this.close()
      return
    }

    const textValue = this.extractTextValue(selected)
    const value = selected.getAttribute("data-autocomplete-value") || textValue
    this.inputTarget.value = textValue

    if (this.hasHiddenTarget) {
      this.hiddenTarget.value = value
      this.hiddenTarget.dispatchEvent(new Event("input"))
      this.hiddenTarget.dispatchEvent(new Event("change"))
    } else {
      this.inputTarget.value = value
    }

    this.inputTarget.focus()
    this.hideAndRemoveOptions()

    this.element.dispatchEvent(
      new CustomEvent("autocomplete.change", {
        bubbles: true,
        detail: { value: value, textValue: textValue }
      })
    )
  }

  clear() {
    this.inputTarget.value = ""
    if (this.hasHiddenTarget) this.hiddenTarget.value = ""
  }

  onResultsClick = (event) => {
    if (!(event.target instanceof Element)) return
    const selected = event.target.closest(optionSelector)
    if (selected) this.commit(selected)
  }

  onResultsMouseDown = () => {
    this.mouseDown = true
    this.resultsTarget.addEventListener("mouseup", () => {
      this.mouseDown = false
    }, { once: true })
  }

  onInputChange = debounce(() => {
    this.element.removeAttribute("value")
    if (this.hasHiddenTarget) this.hiddenTarget.value = ""
    this.fetchResults()
  })

  identifyOptions() {
    let id = 0
    const optionsWithoutId = this.resultsTarget.querySelectorAll(`${optionSelector}:not([id])`)
    optionsWithoutId.forEach((el) => {
      el.id = `${this.resultsTarget.id}-option-${id++}`
    })
  }

  hideAndRemoveOptions() {
    this.close()
    this.resultsTarget.innerHTML = null
  }

  fetchResults = async () => {
    if (!this.hasUrlValue) return

    const url = this.buildQueryURL()
    if(!url) return

    try {
      this.element.dispatchEvent(new CustomEvent("loadstart"))
      const html = await this.doFetch(url)
      this.replaceResults(html)
      this.element.dispatchEvent(new CustomEvent("load"))
      this.element.dispatchEvent(new CustomEvent("loadend"))
    } catch(error) {
      this.element.dispatchEvent(new CustomEvent("error"))
      this.element.dispatchEvent(new CustomEvent("loadend"))
      throw error
    }
  }

  buildQueryURL() {
    const query = this.inputTarget.value.trim()

    if (!query || query.length < this.minLengthValue) {
      this.hideAndRemoveOptions()
      return null
    }

    const url = new URL(this.urlValue, window.location.href)
    const params = new URLSearchParams(url.search.slice(1))
    params.append("q", query)
    url.search = params.toString()

    return url.toString()
  }

  doFetch = async (url) => {
    const response = await fetch(url, this.headersForFetch())
    const html = await response.text()
    return html
  }

  replaceResults(html) {
    this.resultsTarget.innerHTML = html
    this.identifyOptions()
    if (!!this.options) {
      this.open()
    } else {
      this.close()
    }
  }

  open() {
    if (this.isHidden) return
    this.showResults()
    this.element.dispatchEvent(
      new CustomEvent("toggle", {
        detail: { action: "open", inputTarget: this.inputTarget, resultsTarget: this.resultsTarget }
      })
    )
  }

  close() {
    if (!this.isHidden) return
    this.hideResults()
    this.element.dispatchEvent(
      new CustomEvent("toggle", {
        detail: { action: "close", inputTarget: this.inputTarget, resultsTarget: this.resultsTarget }
      })
    )
  }

  showResults() {
    this.resultsTarget.hidden = false
    this.element.setAttribute("aria-expanded", "true")
  }

  hideResults() {
    this.resultsTarget.hidden = true
    this.element.setAttribute("aria-expanded", "false")
  }

  get isHidden() {
    return this.resultsTarget.hidden
  }

  get options() {
    return Array.from(this.resultsTarget.querySelectorAll(optionSelector))
  }

  get selectedOption() {
    return this.resultsTarget.querySelector(activeSelector)
  }

  get selectedClassesOrDefault() {
    return this.hasSelectedClass ? this.selectedClasses : ["active"]
  }

  headersForFetch() {
    return { "X-Requested-With": "XMLHttpRequest" } // override if you need
  }

  extractTextValue = el =>
    el.hasAttribute("data-autocomplete-label")
      ? el.getAttribute("data-autocomplete-label")
      : el.textContent.trim()
}

const debounce = (fn, delay = 10) => {
  let timeoutId = null

  return (...args) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(fn, delay)
  }
}

export { Autocomplete }

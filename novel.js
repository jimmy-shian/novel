window.onload = function() {
const contentDiv = document.getElementById("content-nav");
const xhr = new XMLHttpRequest();
xhr.open("GET", "https://jimmy-shian.github.io/novel/nav.txt", true);
xhr.onreadystatechange = function() {
    if (xhr.readyState === XMLHttpRequest.DONE || xhr.status === 200) {
    contentDiv.innerHTML = xhr.responseText;
    }
};
xhr.send();

const contentEnd = document.getElementById("content-end");

const end = new XMLHttpRequest();
end.open("GET", "https://jimmy-shian.github.io/novel/end.txt", true);
end.onreadystatechange = function() {
    if (end.readyState === XMLHttpRequest.DONE || end.status === 200) {
    contentEnd.innerHTML = end.responseText;
    }
};
end.send();
console.log(contentDiv);
console.log(contentEnd);

};



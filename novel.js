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


const title = document.querySelector('h2').textContent.trim();
const match = title.match(/《([^》]*)》/);
const bookTitle = match ? match[1] : '';
console.log(bookTitle);

const form = document.querySelector('form');
form.addEventListener('submit', function(event) {
    event.preventDefault();
    const numberInput = document.querySelector('#numberInput').value.trim();
    if (!/^\d+$/.test(numberInput)) {
        alert('輸入數字');
    } else {
        window.location.href = `${bookTitle}_html${numberInput}.html`;
    }
});

document.querySelector('#numberInput').addEventListener('keyup', function(event) {
    if (event.keyCode === 13) {
        form.submit();
    }
});
};


